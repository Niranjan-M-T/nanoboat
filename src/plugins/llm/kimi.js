import config from '../../utils/config.js';
import logger from '../../utils/logger.js';
import { normalizeOpenAI } from './normalize.js';

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

/**
 * Convert our tool definitions to OpenAI function-calling format.
 * Strips `required` from individual properties (it belongs at parameters level).
 */
function toOpenAITools(toolDefs) {
    return toolDefs.map(t => {
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
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: {
                    type: 'object',
                    properties: cleanProps,
                    ...(required.length > 0 ? { required } : {}),
                },
            },
        };
    });
}

/**
 * Chat with Kimi-K2 via NVIDIA NIM (OpenAI-compatible).
 * @param {{ role: string, content: string }[]} messages
 * @param {object[]} toolDefs
 * @returns {{ text: string, toolCalls: { tool: string, args: object }[] }}
 */
export async function chat(messages, toolDefs = []) {
    const systemMessage = {
        role: 'system',
        content: SYSTEM_PROMPT,
    };

    const body = {
        model: config.kimiModelId,
        messages: [systemMessage, ...messages],
        temperature: 0.7,
        max_tokens: 1024,
    };

    if (toolDefs.length > 0) {
        body.tools = toOpenAITools(toolDefs);
        body.tool_choice = 'auto';
    }

    logger.info({ model: config.kimiModelId, toolCount: toolDefs.length }, 'Calling Kimi-K2 API');

    // 15-second timeout to prevent indefinite hangs
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const res = await fetch(`${BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.nvidiaNimApiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
            const err = await res.text();
            logger.error({ status: res.status, body: err.substring(0, 500) }, 'Kimi-K2 API error');
            const error = new Error(`Kimi-K2 API error: ${res.status}`);
            error.status = res.status;
            throw error;
        }

        const json = await res.json();
        logger.info('Kimi-K2 responded successfully');
        return normalizeOpenAI(json);
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            logger.error('Kimi-K2 API timed out after 15s');
            const error = new Error('Kimi-K2 API timeout');
            error.status = 408;
            throw error;
        }
        throw err;
    }
}

const SYSTEM_PROMPT = `You are Nanobot, a concise and helpful personal assistant.

You have access to tools. Use them when the user's request matches a tool's purpose.
Each tool has an "action" parameter to select the operation.

TOOL SELECTION RULES:
- Something DONE (action item, deadline, to-do) → task_tool (actions: add, list, complete, update, delete)
- Something REMEMBERED (info, reference, quick note) → note_tool (actions: save, search, list, delete)
- COMMUNICATE (send/read email) → email_tool (actions: read, search, send)
- SCHEDULE (meeting, appointment, event) → calendar_tool (actions: list, create, update, delete)
- FILES (find, create, upload) → drive_tool (actions: list, create_doc, create_sheet, delete)
- SPREADSHEET DATA (read/write cells) → read_sheet or write_sheet
- DOCUMENT CONTENT (read/append text) → read_doc or write_doc
- Simple conversation or question → reply directly, no tools needed

IMPORTANT: Always set the "action" parameter when calling a tool.

Be concise. No filler. Direct answers.`;

