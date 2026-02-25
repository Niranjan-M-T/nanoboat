import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../../utils/config.js';
import logger from '../../utils/logger.js';

let genAI;
let model;
let chatModel;

const CHAT_SYSTEM_INSTRUCTION = `You are Nanobot, a concise and helpful personal assistant with tool access.

CRITICAL RULES:
1. NEVER ask the user for spreadsheet IDs, file IDs, event IDs, or technical details. Find them yourself using tools.
2. ALWAYS use tools proactively. If a request involves files, calendar, tasks, email, or notes — call the tool immediately.
3. Each tool has an "action" parameter — always set it.

TOOL SELECTION:
- SCHEDULE (meeting, event, appointment) → calendar_tool (action: create/list/update/delete)
- ACTION ITEM (task, todo, deadline) → task_tool (action: add/list/complete/update/delete)
- REMEMBER (note, info, reference) → note_tool (action: save/search/list/delete)
- EMAIL (send, read, search) → email_tool (action: read/search/send)
- FILE/SHEET/DOC mentioned by name → drive_tool (action: list, query: "name") to find it FIRST
- READ spreadsheet data → read_sheet (spreadsheet_id, range)
- WRITE spreadsheet data → write_sheet (spreadsheet_id, range, values)
- READ document → read_doc (document_id)
- WRITE document → write_doc (document_id, content)

MULTI-STEP WORKFLOWS:
When user mentions a file by name (e.g. "my petrol expenses sheet"):
1. Call drive_tool with action "list" and query with the file name
2. From the results, get the file ID
3. Call read_sheet to understand the format (columns, existing data)
4. Then either ask the user what specific data to add, or write the data

NEVER ask users for IDs. ALWAYS search for files yourself.
Be concise. No filler. Direct answers.`;

function init() {
    if (!genAI) {
        genAI = new GoogleGenerativeAI(config.googleAiApiKey);
        model = genAI.getGenerativeModel({ model: config.geminiModelId });
        chatModel = genAI.getGenerativeModel({
            model: config.geminiModelId,
            systemInstruction: CHAT_SYSTEM_INSTRUCTION,
        });
    }
}

/**
 * Gemini is used as the CONFIRMATION LAYER, not the primary chat model.
 *
 * Given a destructive action + args, it generates a clear, human-readable
 * confirmation prompt for the user.
 */
export async function generateConfirmation(toolName, args) {
    init();

    const prompt = `You are a safety confirmation system. A user's AI assistant wants to perform this action:

Action: ${toolName}
Details: ${JSON.stringify(args, null, 2)}

Generate a SHORT, clear confirmation message for the user. Include:
1. What will happen (in plain language)
2. Key details (recipient, subject, etc.)
3. End with "Confirm? (yes/no)"

Be concise. Max 3 lines.`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        return text || `⚠️ Confirm **${toolName}**?\n\`${JSON.stringify(args)}\`\n(yes/no)`;
    } catch (err) {
        logger.error({ err, tool: toolName }, 'Gemini confirmation failed');
        // Fallback to a simple prompt
        return `⚠️ I'd like to **${toolName}** with:\n\`\`\`\n${JSON.stringify(args, null, 2)}\n\`\`\`\nConfirm? (yes/no)`;
    }
}

/**
 * Gemini as FALLBACK chat (only if Kimi-K2 is completely down).
 */
export async function chat(messages, toolDefs = []) {
    init();

    const tools = toolDefs.length > 0
        ? [{
            functionDeclarations: toolDefs.map(t => {
                const params = t.parameters || {};
                const required = Object.entries(params)
                    .filter(([, v]) => v.required)
                    .map(([k]) => k);

                // Clone properties without the `required` field
                const cleanProps = {};
                for (const [k, v] of Object.entries(params)) {
                    const { required: _, ...rest } = v;
                    cleanProps[k] = rest;
                }

                return {
                    name: t.name,
                    description: t.description,
                    parameters: {
                        type: 'object',
                        properties: cleanProps,
                        ...(required.length > 0 ? { required } : {}),
                    },
                };
            }),
        }]
        : [];

    // Build history: filter to only user/assistant, ensure alternating turns
    const validMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant');
    const sanitized = [];
    for (const m of validMessages) {
        const geminiRole = m.role === 'assistant' ? 'model' : 'user';
        // Skip consecutive same-role messages (merge or skip)
        if (sanitized.length > 0 && sanitized[sanitized.length - 1].role === geminiRole) {
            // Merge with previous
            sanitized[sanitized.length - 1].parts[0].text += '\n' + m.content;
        } else {
            sanitized.push({ role: geminiRole, parts: [{ text: m.content }] });
        }
    }

    // Ensure history starts with 'user' and ends alternating
    const history = sanitized.slice(0, -1);
    if (history.length > 0 && history[0].role !== 'user') {
        history.shift();
    }

    const maxRetries = 1;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const chatSession = chatModel.startChat({
                history,
                tools,
            });

            const lastMsg = validMessages[validMessages.length - 1];
            const result = await chatSession.sendMessage(lastMsg.content);
            const response = result.response;

            const parts = response.candidates?.[0]?.content?.parts || [];
            let text = '';
            const toolCalls = [];

            for (const part of parts) {
                if (part.text) text += part.text;
                if (part.functionCall) {
                    toolCalls.push({
                        tool: part.functionCall.name,
                        args: part.functionCall.args || {},
                    });
                }
            }

            logger.info({ toolCalls: toolCalls.length, hasText: !!text, parts: parts.length }, 'Gemini responded');
            if (parts.length === 0) {
                logger.warn({ response: JSON.stringify(response) }, 'Gemini returned empty parts list');
            }
            return { text, toolCalls };
        } catch (err) {
            const isQuotaError = err.message?.includes('Quota exceeded') || err.message?.includes('429') || err.status === 429 || err.status === 503;

            if (isQuotaError && attempt < maxRetries) {
                // Parse retry delay from error or default to 25s
                const retryMatch = err.message?.match(/retryDelay.*?(\d+)s/);
                const waitSec = retryMatch ? parseInt(retryMatch[1]) + 2 : 25;
                logger.warn({ waitSec, attempt }, 'Gemini quota exceeded, retrying after delay');
                await new Promise(r => setTimeout(r, waitSec * 1000));
                continue;
            }

            logger.error({ err: err.message, status: err.status }, 'Gemini chat failed');
            throw err;
        }
    }
}
