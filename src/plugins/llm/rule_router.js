/**
 * Rule-Based Intent Router (90% Code, 10% LLM)
 * Instead of asking the LLM to guess the intent from scratch, we use Regex / Keywords
 * to classify the message extremely fast.
 * The LLM (smollm2:360m) is ONLY called afterward to extract the specific JSON parameters.
 */

export function classifyIntent(text) {
    const lower = text.toLowerCase();

    // Ignore pure links, emojis, or very short generic messages
    if (text.trim().length <= 2) return "chat";
    if (lower.match(/^https?:\/\//)) return "chat";

    // 1. Tasks / Reminders (Action items)
    // "Call me at 10pm", "Remind me to buy milk", "Schedule a call", "Add task to my list"
    if (lower.match(/\b(call|remind|schedule|todo|task)\b/)) {
        // Exclude generic phrases like "call me" if it's just group slang, 
        // but for a personal assistant, usually "call me at X" is a task.
        return "task_tool";
    }

    // 2. Calendar / Meetings / Events / Deadlines
    // "Meeting at 10", "Shoot at 10", "Class starts at 8am", "Assignment due tomorrow", "set a meting for 10am tmrw"
    if (lower.match(/\b(meet|meeting|meting|appointment|calendar|calndr|book|slot|shoot|class|clas|assignment|assignmnt)\b/)) {
        // Exclude questions like "can we have a meeting?" or anything ending with "?"
        if (text.includes('?') || lower.match(/\b(can we|could we|should we|do you want|shall we)\b/)) {
            return "chat";
        }

        // Ensure there is a time/date indicator in the message to make it definitive
        if (lower.match(/\b(at|due|tomorrow|tomorow|tommorow|tmrw|today|start|starts|ends|pm|am|on|next)\b|\d{1,2}(:|\s)?\d{2}?\s?(am|pm)?/)) {
            return "calendar_tool";
        }
    }

    // 3. Email (Communication)
    // "Send an email to john", "Check my mail", "Draft an email"
    if (lower.match(/\b(email|mail|send an email)\b/)) {
        return "email_tool";
    }

    // 4. Notes (Information retention)
    // "Remember this password", "Save this note", "Take a note"
    if (lower.match(/\b(note|remember this|save)\b/)) {
        return "note_tool";
    }

    // 5. Google Drive / Documents (Handled exclusively by Gemini for multi-step reasoning)
    // "Find my petrol sheet", "Open the tax document" -> Falls through to Chat/Gemini

    // Default fallback to chat (which is either ignored in passive mode or sent to Gemini)
    return "chat";
}

/**
 * Highly tuned prompts specific to smollm2:360m parameter extraction.
 * Since the small model struggles with complex zero-shot generation, 
 * we give it ONE job: extract the entities for the specific tool we already chose.
 */
export function getPromptForIntent(intent, localISOTime) {
    const base = `You are a strict data extraction engine. 
Current LOCAL Time: ${localISOTime}
OUTPUT ONLY VALID JSON. NO MARKDOWN. NO BACKTICKS. NO EXPLANATIONS.`;

    const prompts = {
        "task_tool": `${base}
Extract a task title and due date from the user's message.
JSON schema to strictly follow:
{"action": "add", "title": "string", "due_date": "string (raw time phrase)"}

RULES:
1. "due_date" is optional. If no time is specified, use "".
2. If the message starts with "[From: Name]" and says "Call me", the title MUST be "Call Name". Keep names exactly as they are (even if they are phone numbers).
3. Do NOT include times in the title.
4. For "due_date", extract the exact time phrase (e.g. "tomorrow", "tonight", "at 5pm"). Do NOT convert to ISO.
5. "action" MUST ALWAYS be exactly "add".

Example: "[From: Mom]: Call me tomorrow at 10pm"
Output: {"action": "add", "title": "Call Mom", "due_date": "tomorrow at 10pm"}

Example: "Buy groceries on friday"
Output: {"action": "add", "title": "Buy groceries", "due_date": "on friday"}
`,

        "calendar_tool": `${base}
Extract an event title and start time from the user's message.
JSON schema to strictly follow:
{"action": "create", "title": "string", "start": "string (raw time phrase)"}

RULES:
1. "action" MUST ALWAYS be exactly "create". Do not output anything else.
2. If no time is specified, leave "start" empty ("").
3. DO NOT hallucinate names. Extract the title strictly from the text provided.
4. "start" MUST be the exact time phrase mentioned in the text (e.g. "tomorrow at 3pm", "friday"). Do NOT convert to ISO.
5. "shoot", "class", or "assignment" are valid event titles.

Example: "Set up a meeting for tomorrow at 3pm"
Output: {"action": "create", "title": "Meeting", "start": "tomorrow at 3pm"}

Example: "Shoot at 10"
Output: {"action": "create", "title": "Shoot", "start": "at 10"}

Example: "Class starts at 8am tommorow"
Output: {"action": "create", "title": "Class", "start": "at 8am tommorow"}
`,

        "email_tool": `${base}
Extract email fields from the user's message.
JSON schema to strictly follow:
{"action": "send", "to": "string", "subject": "string", "body": "string"}
`,

        "note_tool": `${base}
Extract the core information to save as a note.
JSON schema to strictly follow:
{"action": "save", "content": "string"}
`,
        "chat": "You are a helpful assistant. Reply to the user."
    };

    return prompts[intent] || prompts["chat"];
}
