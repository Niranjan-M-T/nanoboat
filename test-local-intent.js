import { extractIntent } from './src/plugins/llm/ollama_local.js';
import logger from './src/utils/logger.js';
logger.level = 'silent';

const toolDefs = [
    {
        name: 'calendar_tool',
        description: 'Calendar events',
        parameters: { action: 'string', title: 'string', start: 'string' }
    }
];

const cases = [
    // ── Interrogative (Should be IGNORED) ──
    "Could we have a meeting tonight ?",
    "Hey, could we have a meeting tommorow",
    "can we have a meeting today",
    "Can we shoot tomorrow morning?",
    "Are we having class tomorrow?",
    "Do you have the assignment?",
    "When is the shoot?",
    "Should we fix a meeting at 10?",

    // ── Definitive / Actionable (Should be CALENDAR_TOOL) ──
    "Lets fix the meeting at 10",
    "Meeting at 10",
    "Shoot at 10",
    "Class starts at 8am tommorow",
    "Assignment for social marketing due tommorow",
    "My shoot is at 10 tomorrow",
    "Shoot tomorrow 10am",
    "Assignment is due on friday at 5pm",
    "Class from 10 to 12 tomorrow",
    "Fix a meeting at 4:30pm today",

    // ── Difficult Edge Cases (Typos, Slang, Noisy Context) ──
    "set a meting for 10am tmrw", // Typo in meeting, slang tmrw
    "schedul shoot at 4pm on fri", // Typo in schedule, abbreviated friday
    "clas at 8 tomorow", // Typo in class, typo in tomorrow
    "gota finish assignmnt by 5pm today", // Slang, typo in assignment
    "lets meet up at 10 30 am tommorow", // meet up, spaced time, typo
    "shd we meat at 10?", // Interrogative, typo in should and meet
    "I was thinking, maybe we should, I don't know, fix a meeting at 4:30pm today if that works for you?", // Noisy interrogative
    "calndr event: shoot tomorow 11 am" // Prefix typo, typo in tomorrow
];

async function runTests() {
    console.log("--- Local Intent (Regex + smollm2) Edge Case Testing ---");

    for (let i = 0; i < cases.length; i++) {
        const text = cases[i];
        console.log(`\\n[Test ${i + 1}] Input: "${text}"`);

        try {
            // This runs the real pipeline: classifyIntent (Regex) -> getPrompt -> smollm2 JSON extraction
            const result = await extractIntent(text, toolDefs);

            if (result.intent === 'chat') {
                console.log(`Result: \x1b[33mIGNORED (chat)\x1b[0m`);
            } else {
                console.log(`Result: \x1b[32mROUTED to ${result.intent}\x1b[0m`);
                console.log(`Params:`, result.args);
            }
        } catch (err) {
            console.error(`Error: ${err.message}`);
        }
    }
}

runTests();
