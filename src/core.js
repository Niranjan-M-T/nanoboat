import logger from './utils/logger.js';
import * as chat from './memory/chat.js';
import { needsConfirmation, createConfirmation, resolveConfirmation, cleanExpired } from './confirm.js';
import config from './utils/config.js';

/**
 * Core engine — the central nervous system of Nanobot.
 *
 * Plugins register tools via core.addTool().
 * Bridges call core.handleMessage().
 * The core routes to LLM, dispatches tool calls, handles confirmations.
 */
export default class Core {
    constructor() {
        this.tools = new Map();        // name → { definition, handler }
        this.bridges = new Map();      // source → sendFn(userId, text)
        this.llm = null;               // set by LLM plugin
        this.listeners = {};           // event → handler[]
        this.db = null;                // set in index.js
        this.logger = logger;
    }

    // ── Plugin API ──────────────────────────────────

    /**
     * Register a tool the LLM can call.
     * @param {string} name         Unique tool name
     * @param {object} definition   { description, parameters, destructive? }
     * @param {Function} handler    async (args) => result
     */
    addTool(name, definition, handler) {
        this.tools.set(name, { definition, handler });
        logger.debug({ tool: name }, 'Tool registered');
    }

    /**
     * Register a message bridge (telegram, whatsapp, etc).
     * @param {string} source    e.g. 'telegram', 'whatsapp'
     * @param {Function} sendFn  async (userId, text) => void
     */
    addBridge(source, sendFn) {
        this.bridges.set(source, sendFn);
        logger.debug({ source }, 'Bridge registered');
    }

    /**
     * Set the LLM chat function.
     * @param {Function} chatFn  async (messages, toolDefs) => { text, toolCalls }
     */
    setLLM(chatFn) {
        this.llm = chatFn;
    }

    /**
     * Set the Gemini confirmation function.
     * @param {Function} confirmFn  async (action, args) => string (confirmation prompt)
     */
    setConfirmLLM(confirmFn) {
        this.confirmLLM = confirmFn;
    }

    /**
     * Set a fast follow-up LLM (Gemini) for tool result processing.
     * Used to avoid Kimi timeout on follow-up calls in the agentic loop.
     * @param {Function} followUpFn  async (messages, toolDefs) => { text, toolCalls }
     */
    setFollowUpLLM(followUpFn) {
        this.followUpLLM = followUpFn;
    }

    /**
     * Set the Intent Router (Local LLM) for intent classification.
     * @param {Function} routerFn  async (text, toolDefs) => { intent, args }
     */
    setIntentRouter(routerFn) {
        this.intentRouter = routerFn;
    }

    /**
     * Simple event emitter.
     */
    on(event, handler) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(handler);
    }

    async emit(event, ...args) {
        for (const handler of this.listeners[event] || []) {
            await handler(...args);
        }
    }

    /**
     * Send a proactive push notification to the primary admin via Telegram
     */
    notifyAdmin(markdownText) {
        const tgBridge = this.bridges.get('telegram');
        const adminId = config.telegramAllowedUsers?.[0];
        if (tgBridge && adminId) {
            tgBridge(adminId, markdownText).catch(e => logger.warn({ err: e.message }, 'Failed to send admin notification'));
        }
    }

    // ── Message Handling ────────────────────────────

    /**
     * Handle an incoming message from any bridge.
     * @param {string} source   e.g. 'telegram', 'whatsapp'
     * @param {string} userId
     * @param {string} text
     * @param {object} meta     Optional metadata like { passive: true }
     */
    async handleMessage(source, userId, text, meta = {}) {
        logger.info({ source, userId, text: text.substring(0, 100), meta }, 'Incoming message');

        // 1. Check if this is a confirmation reply
        const yes = /^(yes|y|confirm|ok|do it|go ahead|proceed)$/i.test(text.trim());
        if (yes) {
            const pending = resolveConfirmation(userId);
            if (pending) {
                return this._executeSingle(source, userId, pending.tool, pending.args);
            }
        }

        const no = /^(no|n|cancel|abort|stop|nah)$/i.test(text.trim());
        if (no) {
            const pending = resolveConfirmation(userId);
            if (pending) {
                return this._reply(source, userId, '❌ Action cancelled.');
            }
        }

        // 2. Save user message to chat memory
        chat.append(userId, 'user', text);

        // 3. Build LLM context
        const history = chat.getHistory(userId);
        const toolDefs = this._getToolDefinitions();

        // 4. Try Local Intent Router Early-Out (Hybrid Command Engine)
        if (this.intentRouter) {
            try {
                const start = Date.now();
                const route = await this.intentRouter(text, toolDefs);
                logger.info({ route, ms: Date.now() - start }, 'Intent Router result');

                // If it's not a generic chat, try to execute the tool immediately
                if (route && route.intent !== 'chat') {
                    const toolName = route.intent;
                    if (this.tools.has(toolName)) {
                        // Create a fake tool call object for the existing pipeline
                        const fakeCall = { tool: toolName, args: route.args || {} };
                        return this._handleToolCall(source, userId, fakeCall, `Executing ${toolName}...`);
                    } else {
                        logger.warn({ tool: toolName }, 'Local LLM suggested unknown tool');
                    }
                }
            } catch (err) {
                logger.error({ err }, 'Intent Router failed, falling back to full LLM');
            }
        }

        // 5. Passive Mode Check: If local LLM failed or returned 'chat', drop it completely
        if (meta.passive) {
            logger.info('Passive message dropped to save Gemini quota');
            return;
        }

        // 6. Fallback to full Cloud LLM
        if (!this.llm) {
            return this._reply(source, userId, '⚠️ LLM not configured.');
        }

        try {
            const result = await this.llm(history, toolDefs);

            // 6. Handle tool calls with agentic loop
            if (result.toolCalls && result.toolCalls.length > 0) {
                return this._agenticLoop(source, userId, result.toolCalls, history, toolDefs);
            }

            // 7. Plain text reply
            if (result.text) {
                chat.append(userId, 'assistant', result.text);
                return this._reply(source, userId, result.text);
            }
        } catch (err) {
            logger.error({ err, userId }, 'LLM call failed');
            return this._reply(source, userId, '⚠️ Something went wrong. Please try again.');
        }
    }

    // ── Internal ────────────────────────────────────

    /**
     * Agentic loop: execute tool calls, feed results back to LLM,
     * repeat until LLM gives a text response or max iterations reached.
     */
    async _agenticLoop(source, userId, toolCalls, history, toolDefs) {
        const MAX_ITERATIONS = 5;
        let currentCalls = toolCalls;
        // Use follow-up LLM (Gemini direct) for iterations to skip Kimi timeout
        const llmFn = this.followUpLLM || this.llm;

        for (let i = 0; i < MAX_ITERATIONS; i++) {
            // Execute each tool call
            for (const call of currentCalls) {
                const res = await this._handleToolCall(source, userId, call, "Processing in agentic loop", history);
                if (res === 'CONFIRMATION_PENDING') return; // Break entirely if confirmation needed
            }

            // Feed results back to LLM for next step
            try {
                const nextResult = await llmFn(history, toolDefs);

                if (nextResult.toolCalls && nextResult.toolCalls.length > 0) {
                    // LLM wants more tool calls — continue loop
                    currentCalls = nextResult.toolCalls;
                    continue;
                }

                // LLM gave a text response — we're done
                if (nextResult.text) {
                    chat.append(userId, 'assistant', nextResult.text);
                    return this._reply(source, userId, nextResult.text);
                }
            } catch (err) {
                logger.error({ err }, 'Follow-up LLM call failed');
                // Fall through to return last tool result
                break;
            }
        }

        // Max iterations or follow-up failed — send last tool result
        const lastResult = history[history.length - 1]?.content || 'Done.';
        const reply = `✅ ${lastResult}`;
        chat.append(userId, 'assistant', reply);
        return this._reply(source, userId, reply);
    }

    /**
     * Execute a single tool and handle confirmation routing.
     * Returns 'CONFIRMATION_PENDING' if user input is needed.
     */
    async _handleToolCall(source, userId, call, textContext = '', history = null) {
        const { tool, args } = call;
        logger.info({ tool, args }, 'Tool call dispatched');
        const entry = this.tools.get(tool);

        if (!entry) {
            logger.warn({ tool, args }, 'Unknown tool called');
            const msg = `⚠️ Unknown action: ${tool}`;
            chat.append(userId, 'assistant', msg);
            this._reply(source, userId, msg);
            return 'ERROR';
        }

        // Check if destructive → confirmation needed
        if (needsConfirmation(tool, args)) {
            let promptText;
            if (this.confirmLLM) {
                promptText = await this.confirmLLM(tool, args);
            } else {
                promptText = `⚠️ I'd like to **${tool}** with:\n\`\`\`\n${JSON.stringify(args, null, 2)}\n\`\`\`\nConfirm? (yes/no)`;
            }
            createConfirmation(source, userId, tool, args, promptText);
            this._reply(source, userId, promptText);
            return 'CONFIRMATION_PENDING';
        }

        // Safe tool → execute immediately
        try {
            const result = await entry.handler(args);
            const resultText = typeof result === 'string' ? result : JSON.stringify(result);
            logger.info({ tool, resultLength: resultText.length }, 'Tool executed');

            // Send push notification to Telegram if a background automation modified state
            const action = (args.action || '').toLowerCase();
            if (['task_tool', 'calendar_tool', 'email_tool'].includes(tool) && !['list', 'search', 'read'].includes(action)) {
                const icon = tool === 'task_tool' ? '📝' : tool === 'calendar_tool' ? '📅' : '📧';
                const payload = JSON.stringify(args, null, 2);
                const msg = `*${icon} Automated Action Executed*\n\n*Tool:* \`${tool}\`\n*Action:* \`${action}\`\n*Payload:*\n\`\`\`json\n${payload}\n\`\`\`\n*Result:*\n${resultText}\n\n*Triggered via:* \`${source}\``;
                this.notifyAdmin(msg);
            }

            if (history) {
                history.push({ role: 'assistant', content: `[Called ${tool}: ${JSON.stringify(args)}]` });
                history.push({ role: 'user', content: `[Tool result: ${resultText}]` });
            } else {
                const reply = `✅ ${resultText}`;
                chat.append(userId, 'assistant', reply);
                this._reply(source, userId, reply);
            }
            return 'SUCCESS';
        } catch (err) {
            logger.error({ err, tool }, 'Tool execution failed');
            const errMsg = `❌ Failed to execute ${tool}: ${err.message}`;
            chat.append(userId, 'assistant', errMsg);
            this._reply(source, userId, errMsg);
            return 'ERROR';
        }
    }

    /**
     * Execute a single tool (used for confirmation flow).
     */
    async _executeSingle(source, userId, toolName, args) {
        const entry = this.tools.get(toolName);
        if (!entry) return;

        try {
            const result = await entry.handler(args);
            const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

            // Send push notification for confirmed actions
            const action = (args.action || '').toLowerCase();
            const icon = toolName === 'email_tool' ? '📧' : '⚠️';
            const payload = JSON.stringify(args, null, 2);
            const msg = `*${icon} User Confirmed Action Executed*\n\n*Tool:* \`${toolName}\`\n*Payload:*\n\`\`\`json\n${payload}\n\`\`\`\n*Result:*\n${resultText}`;
            this.notifyAdmin(msg);

            const reply = `✅ ${resultText}`;
            chat.append(userId, 'assistant', reply);
            return this._reply(source, userId, reply);
        } catch (err) {
            logger.error({ err, tool: toolName }, 'Tool execution failed');
            return this._reply(source, userId, `❌ Failed to execute ${toolName}: ${err.message}`);
        }
    }

    async _reply(source, userId, text) {
        const sendFn = this.bridges.get(source);
        if (sendFn) {
            await sendFn(userId, text);
        } else {
            logger.warn({ source }, 'No bridge registered for source');
        }
    }

    _getToolDefinitions() {
        const defs = [];
        for (const [name, { definition }] of this.tools) {
            defs.push({ name, ...definition });
        }
        return defs;
    }

    /**
     * Send a proactive message (e.g. from scheduler).
     */
    async sendProactive(source, userId, text) {
        return this._reply(source, userId, text);
    }
}
