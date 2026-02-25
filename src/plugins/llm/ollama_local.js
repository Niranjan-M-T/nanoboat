import config from '../../utils/config.js';
import logger from '../../utils/logger.js';

/**
 * Local Intent Router using Ollama
 * Maps user text directly to a tool call without complex reasoning.
 */
export async function extractIntent(text, toolDefs) {
    // Build a simple description of tools for the small LLM
    const toolDescriptions = toolDefs.map(t => {
        const params = Object.keys(t.parameters || {}).join(', ');
        return `- ${t.name}: ${t.description.split('\n')[0]} (params: ${params})`;
    }).join('\n');

    // Get current local time in ISO format with timezone offset
    const now = new Date();
    const tzOffsetMs = now.getTimezoneOffset() * 60000;
    const localISOTimeWithoutZ = (new Date(now.getTime() - tzOffsetMs)).toISOString().slice(0, -1);

    // Format the offset as +HH:mm or -HH:mm
    const offsetHours = Math.abs(Math.floor(now.getTimezoneOffset() / 60)).toString().padStart(2, '0');
    const offsetMinutes = Math.abs(now.getTimezoneOffset() % 60).toString().padStart(2, '0');
    const offsetSign = now.getTimezoneOffset() > 0 ? '-' : '+';
    const tzString = `${offsetSign}${offsetHours}:${offsetMinutes}`;

    const localISOTime = `${localISOTimeWithoutZ}${tzString}`;

    const systemPrompt = `You are a fast intent routing engine.
Your job is to read the user's message and map it to ONE of the available tools.
If the message is a general chat, greeting, or complex request, use the literal intent "chat".

Current LOCAL Date & Time: ${localISOTime}

AVAILABLE TOOLS:
${toolDescriptions}

RULES:
1. Output ONLY valid JSON.
2. The JSON must have exactly two keys: "intent" and "args".
3. "intent" must be the exact name of the tool, OR "chat".
4. "args" must be an object containing the parameters needed for the tool. Use empty object {} for "chat".
5. DATES AND TIMES MUST BE IN VALID ISO 8601 LOCAL FORMAT (e.g., "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss"). DO NOT USE the 'Z' timezone suffix. Resolve words like "tomorrow" using the Current LOCAL Date provided.

EXAMPLE 1:
User: "schedule a meeting with bob tomorrow at 3pm"
Output: {"intent": "calendar_tool", "args": {"action": "create", "title": "Meeting with Bob", "start": "2026-02-26T15:00:00"}}

EXAMPLE 2:
User: "Hi, how are you?"
Output: {"intent": "chat", "args": {}}`;

    const body = {
        model: config.ollamaModelId || 'qwen2.5:1.5b',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
        ],
        format: 'json',
        stream: false,
        temperature: 0.1, // extremely low for predictable routing
    };

    try {
        logger.info({ model: body.model, text: text.substring(0, 50) }, 'Calling Local Ollama for Intent');
        const url = config.ollamaUrl || 'http://127.0.0.1:11434/api/chat';
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            throw new Error(`Ollama API error: ${res.statusText}`);
        }

        const data = await res.json();
        const jsonText = data.message?.content?.trim() || '{}';

        // Parse the JSON intent
        const parsed = JSON.parse(jsonText.replace(/```json/g, '').replace(/```/g, ''));
        logger.info({ intent: parsed.intent, args: parsed.args }, 'Local Intent Extracted');
        return parsed;

    } catch (err) {
        logger.error({ err: err.message }, 'Failed to extract intent from Local LLM');
        // Fallback to chat if intent extraction fails
        return { intent: 'chat', args: {} };
    }
}
