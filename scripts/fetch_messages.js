import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import qrcode from 'qrcode-terminal';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const SCENARIOS_FILE = path.join(DATA_DIR, 'scenarios.json');

console.log('Starting WhatsApp Client to fetch recent messages...');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(DATA_DIR, 'whatsapp-session') }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
    }
});

client.on('qr', (qr) => {
    console.log('QR RECEIVED. Please scan:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('WhatsApp Client is ready!');
    console.log('Fetching chats...');

    try {
        const chats = await client.getChats();
        let allMessages = [];

        // Grab messages from the top 5 most active chats
        for (let i = 0; i < Math.min(5, chats.length); i++) {
            const chat = chats[i];
            console.log(`Fetching messages from: ${chat.name || chat.id._serialized}`);
            const messages = await chat.fetchMessages({ limit: 40 }); // Total up to 200

            for (const msg of messages) {
                if (msg.body && msg.body.trim().length > 0) {
                    allMessages.push({
                        id: msg.id._serialized,
                        from: msg.from,
                        body: msg.body.trim(),
                        timestamp: msg.timestamp,
                        isGroup: chat.isGroup
                    });
                }
            }
        }

        // Sort by timestamp descending
        allMessages.sort((a, b) => b.timestamp - a.timestamp);

        // Take top 100
        const scenarios = allMessages.slice(0, 100).map(m => ({
            input: m.body,
            expectedIntent: "UNKNOWN",
            context: m.isGroup ? "group" : "dm",
            notes: ""
        }));

        fs.writeFileSync(SCENARIOS_FILE, JSON.stringify(scenarios, null, 2));
        console.log(`Saved ${scenarios.length} scenarios to ${SCENARIOS_FILE}`);

        // Let's create a template script for the new Rule-Based router
        createRuleBasedTemplate();

        process.exit(0);
    } catch (err) {
        console.error('Error fetching messages:', err);
        process.exit(1);
    }
});

client.on('auth_failure', () => {
    console.error('Authentication failed. Make sure you are logged in.');
    process.exit(1);
});

client.initialize();

function createRuleBasedTemplate() {
    const routerPath = path.join(__dirname, '..', 'src', 'plugins', 'llm', 'rule_router.js');
    if (!fs.existsSync(routerPath)) {
        const template = `/**
 * Rule-Based Intent Router (90% Code, 10% LLM)
 * Instead of asking the LLM to guess the intent from scratch, we use Regex / Keywords
 * to classify the message, and only call the LLM to extract parameters using specific prompts.
 */

export function classifyIntent(text) {
    const lower = text.toLowerCase();
    
    // 1. Tasks / Reminders
    if (lower.match(/\\b(call|remind|schedule|todo|task)\\b/)) {
        return "add_task";
    }
    
    // 2. Calendar / Meetings
    if (lower.match(/\\b(meeting|appointment|calendar|book|slot)\\b/)) {
        return "calendar_tool";
    }
    
    // 3. Email
    if (lower.match(/\\b(email|send an email to|mail)\\b/)) {
        return "email_tool";
    }
    
    // 4. Notes
    if (lower.match(/\\b(note|remember this|save)\\b/)) {
        return "note_tool";
    }
    
    return "chat"; // Fallback to LLM if no rules match
}

export function getPromptForIntent(intent) {
    const prompts = {
        "add_task": "Extract the task title and due date from the user's message. Output JSON: { title: string, due: string (ISO) }",
        "calendar_tool": "Extract meeting title and start time. Output JSON: { action: 'create', title: string, start: string (ISO) }",
        "email_tool": "Extract email recipient, subject, and body. Output JSON: { to: string, subject: string, body: string }",
        "chat": "You are a helpful assistant. Reply to the user."
    };
    return prompts[intent] || prompts["chat"];
}
`;
        fs.writeFileSync(routerPath, template);
        console.log("Created rule-based router template at " + routerPath);
    }
}
