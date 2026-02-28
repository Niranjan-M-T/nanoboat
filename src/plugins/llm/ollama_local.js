import logger from '../../utils/logger.js';
import * as chrono from 'chrono-node';
import { classifyIntent } from './rule_router.js';

/**
 * Deterministic Intent Extractor (100% Code, 0% LLM)
 * Uses rule_router.js for classification, then chrono-node + regex for parameter extraction.
 * Zero latency, zero rate limits, zero crashes.
 */
export async function extractIntent(text, toolDefs) {
    // 1. Classify intent using the rule router
    const predictedIntent = classifyIntent(text);

    // 2. If it's just 'chat', exit immediately
    if (predictedIntent === 'chat') {
        logger.debug({ text: text.substring(0, 50) }, 'Rule Router: Ignored as Chat');
        return { intent: 'chat', args: {} };
    }

    logger.info({ route: predictedIntent, text: text.substring(0, 50) }, 'Rule Router: Matched Tool');

    // 3. Extract parameters deterministically based on the routed intent
    let args;
    switch (predictedIntent) {
        case 'task_tool':
            args = extractTaskArgs(text);
            break;
        case 'calendar_tool':
            args = extractCalendarArgs(text);
            break;
        case 'email_tool':
            args = extractEmailArgs(text);
            break;
        case 'note_tool':
            args = extractNoteArgs(text);
            break;
        default:
            args = {};
    }

    logger.info({ intent: predictedIntent, args }, 'Deterministic Parameter Extracted');
    return { intent: predictedIntent, args };
}

// ── Helper: Strip "[From: Name]: " prefix ────────────────

function parseSenderPrefix(text) {
    const match = text.match(/^\[From:\s*(.+?)\]:\s*/i);
    if (match) {
        return { sender: match[1].trim(), body: text.slice(match[0].length) };
    }
    return { sender: null, body: text };
}

// ── Task Extraction ──────────────────────────────────────

function extractTaskArgs(text) {
    const { sender, body } = parseSenderPrefix(text);

    // Parse dates with chrono-node
    const parsed = chrono.parse(body);
    let dueDate = '';
    let cleanBody = body;

    if (parsed.length > 0) {
        const ref = parsed[0];
        dueDate = ref.start.date().toISOString();

        // Remove the date phrase from the body to get the title
        cleanBody = body.slice(0, ref.index) + body.slice(ref.index + ref.text.length);
    }

    // Determine the title
    let title = cleanBody
        .replace(/\b(remind me to|remind me|add task|todo|task)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    // Special case: "[From: Mom]: Call me at 10pm" → title = "Call Mom"
    if (sender && /\bcall\s*(me)?\b/i.test(title)) {
        title = `Call ${sender}`;
    } else if (sender && (!title || title.length < 3)) {
        // If message body is too short after stripping, use sender context
        title = `${body.trim()} (from ${sender})`;
    }

    // Fallback: if title is still empty, use the original body
    if (!title || title.length < 2) {
        title = body.trim();
    }

    // Capitalize first letter
    title = title.charAt(0).toUpperCase() + title.slice(1);

    const args = { action: 'add', title };

    if (dueDate) {
        args.due_date = dueDate;

        // If a specific time was mentioned, inject it into notes (Google Tasks loses time info)
        const timePattern = /\b(at|am|pm|tonight|o'clock|morning|evening|\d{1,2}:\d{2}?\s?(am|pm)?)\b/i;
        if (timePattern.test(body)) {
            const rawTimePhrase = parsed[0]?.text || '';
            args.notes = `[Time: ${rawTimePhrase}]`;
        }
    }

    return args;
}

// ── Calendar Extraction ──────────────────────────────────

function extractCalendarArgs(text) {
    const { sender, body } = parseSenderPrefix(text);

    // Parse dates with chrono-node
    const parsed = chrono.parse(body);
    let start = '';
    let cleanBody = body;

    if (parsed.length > 0) {
        const ref = parsed[0];
        start = ref.start.date().toISOString();
        cleanBody = body.slice(0, ref.index) + body.slice(ref.index + ref.text.length);
    }

    // Extract title by removing known calendar keywords
    let title = cleanBody
        .replace(/\b(set up a|set a|schedule a|book a|meeting|meting|appointment|calendar|shoot|class|clas|assignment|assignmnt|starts?|ends?|due)\b/gi, '')
        .replace(/\b(for|on|at)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    // If we stripped too aggressively, fallback to keyword-based title
    if (!title || title.length < 2) {
        // Try to find the core noun in the original body
        const nounMatch = body.match(/\b(meeting|shoot|class|assignment|appointment)\b/i);
        title = nounMatch ? nounMatch[1].charAt(0).toUpperCase() + nounMatch[1].slice(1) : body.trim();
    }

    title = title.charAt(0).toUpperCase() + title.slice(1);

    const args = { action: 'create', title };
    if (start) args.start = start;

    return args;
}

// ── Email Extraction ─────────────────────────────────────

function extractEmailArgs(text) {
    const { body } = parseSenderPrefix(text);

    // Try to extract email address
    const emailMatch = body.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    const to = emailMatch ? emailMatch[0] : '';

    // Try to extract "about <subject>" or "regarding <subject>"
    const subjectMatch = body.match(/\b(?:about|regarding|subject|re)\s+(.+?)(?:\s+(?:saying|with body|body|that|content)|$)/i);
    const subject = subjectMatch ? subjectMatch[1].trim() : '';

    // Try to extract body after "saying" or "with body" or "that says"
    const bodyMatch = body.match(/\b(?:saying|with body|that says|content|body)\s+(.+)/i);
    const emailBody = bodyMatch ? bodyMatch[1].trim() : '';

    return { action: 'send', to, subject, body: emailBody };
}

// ── Note Extraction ──────────────────────────────────────

function extractNoteArgs(text) {
    const { body } = parseSenderPrefix(text);

    // Strip "remember", "save", "note" prefixes
    const content = body
        .replace(/\b(remember this|remember|save this|save|take a note|note)\b/gi, '')
        .replace(/^\s*[:;-]\s*/, '') // Remove leading punctuation after stripping
        .replace(/\s{2,}/g, ' ')
        .trim();

    return { action: 'save', content: content || body.trim() };
}
