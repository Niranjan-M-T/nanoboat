/**
 * Normalize LLM responses from different providers into a unified format.
 *
 * Output: { text: string, toolCalls: { tool: string, args: object }[] }
 *
 * No provider-specific weirdness leaks past this module.
 */

/**
 * Normalize Kimi-K2 (OpenAI-compatible) response.
 */
export function normalizeOpenAI(response) {
    const choice = response.choices?.[0];
    if (!choice) return { text: '', toolCalls: [] };

    const message = choice.message;
    const text = message.content || '';
    const toolCalls = (message.tool_calls || []).map(tc => ({
        tool: tc.function.name,
        args: safeParse(tc.function.arguments),
    }));

    return { text, toolCalls };
}

/**
 * Normalize Gemini response.
 */
export function normalizeGemini(response) {
    const candidate = response.candidates?.[0];
    if (!candidate) return { text: '', toolCalls: [] };

    const parts = candidate.content?.parts || [];
    let text = '';
    const toolCalls = [];

    for (const part of parts) {
        if (part.text) {
            text += part.text;
        }
        if (part.functionCall) {
            toolCalls.push({
                tool: part.functionCall.name,
                args: part.functionCall.args || {},
            });
        }
    }

    return { text, toolCalls };
}

function safeParse(str) {
    if (typeof str === 'object') return str;
    try {
        return JSON.parse(str);
    } catch {
        return {};
    }
}
