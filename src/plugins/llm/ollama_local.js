import config from '../../utils/config.js';
import logger from '../../utils/logger.js';
import * as chrono from 'chrono-node';
import { classifyIntent, getPromptForIntent } from './rule_router.js';

/**
 * Local Intent Router using Rule-Based Regex + Ollama Parameter Extraction (90% Code, 10% LLM)
 * Maps user text directly to a tool call without complex reasoning.
 */
export async function extractIntent(text, toolDefs) {
    // 1. Instantly parse using our robust Keyword/Regex Router
    const predictedIntent = classifyIntent(text);

    // 2. If it's just 'chat', exit immediately without spending LLM tokens.
    if (predictedIntent === 'chat') {
        logger.debug({ text: text.substring(0, 50) }, 'Rule Router: Ignored as Chat');
        return { intent: 'chat', args: {} };
    }

    logger.info({ route: predictedIntent, text: text.substring(0, 50) }, 'Rule Router: Matched Tool');

    // Get current local time in ISO format with timezone offset
    const now = new Date();
    const tzOffsetMs = now.getTimezoneOffset() * 60000;
    const localISOTimeWithoutZ = (new Date(now.getTime() - tzOffsetMs)).toISOString().slice(0, -1);
    const offsetHours = Math.abs(Math.floor(now.getTimezoneOffset() / 60)).toString().padStart(2, '0');
    const offsetMinutes = Math.abs(now.getTimezoneOffset() % 60).toString().padStart(2, '0');
    const offsetSign = now.getTimezoneOffset() > 0 ? '-' : '+';
    const tzString = `${offsetSign}${offsetHours}:${offsetMinutes}`;
    const localISOTime = `${localISOTimeWithoutZ}${tzString}`;

    // 3. Fallback to 10% LLM duty: extracting extremely strict parameters
    const systemPrompt = getPromptForIntent(predictedIntent, localISOTime);

    const body = {
        model: config.ollamaModelId || 'smollm2:360m',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
        ],
        format: 'json',
        stream: false,
        temperature: 0.1, // extremely low for predictable routing
    };

    try {
        let url = config.ollamaUrl || 'http://127.0.0.1:11434/api/chat';
        if (!url.startsWith('http')) url = 'http://' + url;

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
        const parsedArgs = JSON.parse(jsonText.replace(/```json/g, '').replace(/```/g, ''));

        // --- CHRONO-NODE DATE PARSING (90% Code strategy) ---
        // The tiny LLM extracts raw strings like "tomorrow at 5pm". We convert them to strict ISO arrays here.
        if (predictedIntent === 'task_tool') {
            const rawDate = parsedArgs.due_date || parsedArgs.due;
            if (rawDate) {
                const cleanString = rawDate.replace(/tommorow|tomorow|tmrw/gi, 'tomorrow');
                const parsedDate = chrono.parseDate(cleanString);
                if (parsedDate) {
                    parsedArgs.due_date = parsedDate.toISOString();
                    // Google Tasks API natively deletes time data. If a specific time was requested, inject it into notes. 
                    if (/\b(at|am|pm|tonight|o'clock|time|morning|evening|\d{1,2}:\d{2})\b/i.test(cleanString)) {
                        parsedArgs.notes = parsedArgs.notes ? `${parsedArgs.notes}\n[Time: ${rawDate}]` : `[Time: ${rawDate}]`;
                    }
                } else {
                    parsedArgs.due_date = rawDate;
                }
                delete parsedArgs.due;
            }
        } else if (predictedIntent === 'calendar_tool' && parsedArgs.start) {
            const cleanString = parsedArgs.start.replace(/tommorow|tomorow|tmrw/gi, 'tomorrow');
            const parsedDate = chrono.parseDate(cleanString);
            if (parsedDate) {
                parsedArgs.start = parsedDate.toISOString();
            }
        }

        logger.info({ intent: predictedIntent, args: parsedArgs }, 'Local Parameter Extracted');

        return { intent: predictedIntent, args: parsedArgs };

    } catch (err) {
        logger.error({ err: err.message }, 'Failed to extract JSON parameters from Local LLM');
        // Fallback to chat if extraction completely fails
        return { intent: 'chat', args: {} };
    }
}
