import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyIntent, getPromptForIntent } from '../src/plugins/llm/rule_router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCENARIOS_FILE = path.join(__dirname, '..', 'data', 'scenarios.json');

async function askOllama(prompt, text) {
    const body = {
        model: 'smollm2:360m',
        messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: text }
        ],
        format: 'json',
        stream: false,
        temperature: 0.1
    };

    try {
        const res = await fetch('http://127.0.0.1:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        return JSON.parse(data.message.content.trim().replace(/```json/g, '').replace(/```/g, ''));
    } catch (err) {
        return { error: err.message, raw: err };
    }
}

async function runTests() {
    if (!fs.existsSync(SCENARIOS_FILE)) {
        console.error('No scenarios.json found. Run fetch_messages.js first.');
        process.exit(1);
    }

    const scenarios = JSON.parse(fs.readFileSync(SCENARIOS_FILE, 'utf8'));
    console.log(`Loaded ${scenarios.length} test scenarios.`);
    console.log('--------------------------------------------------');

    let chatCount = 0;
    let toolCount = 0;
    const now = new Date().toISOString();

    for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];

        let text = scenario.input;
        if (scenario.context === 'dm') {
            text = `[From: User]: ${text}`;
        } else {
            text = `[From: Group Member]: ${text}`;
        }

        const predictedIntent = classifyIntent(text);

        if (predictedIntent === 'chat') {
            chatCount++;
        } else {
            toolCount++;
            console.log(`[SCENARIO ${i + 1}] ${scenario.context.toUpperCase()}`);
            console.log(`User:     ${scenario.input.replace(/\\n/g, ' ')}`);
            console.log(`Classify: \x1b[32m${predictedIntent}\x1b[0m`);

            // Now test extraction
            const prompt = getPromptForIntent(predictedIntent, now);
            console.log(`Waiting for smollm2:360m parameters...`);
            const params = await askOllama(prompt, text);
            console.log(`Params:`, params);
            console.log('---');
        }
    }

    console.log('==================================================');
    console.log('TEST SUMMARY (RULE ROUTER + SMOLLM)');
    console.log(`Total Scenarios: ${scenarios.length}`);
    console.log(`Filtered as Chat (Ignored): ${chatCount}`);
    console.log(`Routed to Tools & Extracted: ${toolCount}`);
}

runTests();
