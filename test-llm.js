/**
 * Standalone LLM test — verifies both Kimi-K2 and Gemini APIs work
 * before running the full bot.
 *
 * Usage: node test-llm.js
 */
import 'dotenv/config';

const KIMI_API_KEY = process.env.NVIDIA_NIM_API_KEY;
const GEMINI_API_KEY = process.env.GOOGLE_AI_API_KEY;
const KIMI_MODEL = process.env.KIMI_MODEL_ID || 'moonshotai/kimi-k2-instruct';
const GEMINI_MODEL = process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash';

// ── Test tool definition (clean, no `required` on props) ──
const TEST_TOOLS_OPENAI = [{
    type: 'function',
    function: {
        name: 'add_task',
        description: 'Create a task. Use for things that need to be DONE.',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'What needs to be done' },
                due_date: { type: 'string', description: 'ISO date' },
            },
            required: ['title'],
        },
    },
}];

const TEST_TOOLS_GEMINI = [{
    functionDeclarations: [{
        name: 'add_task',
        description: 'Create a task. Use for things that need to be DONE.',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'What needs to be done' },
                due_date: { type: 'string', description: 'ISO date' },
            },
            required: ['title'],
        },
    }],
}];

// ── Test 1: Kimi-K2 via NVIDIA NIM ──
async function testKimi() {
    console.log('\n═══ Test 1: Kimi-K2 (NVIDIA NIM) ═══');
    console.log(`Model: ${KIMI_MODEL}`);
    console.log(`URL: https://integrate.api.nvidia.com/v1/chat/completions`);

    try {
        const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${KIMI_API_KEY}`,
            },
            body: JSON.stringify({
                model: KIMI_MODEL,
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'Say hello in one sentence.' },
                ],
                temperature: 0.7,
                max_tokens: 100,
                tools: TEST_TOOLS_OPENAI,
                tool_choice: 'auto',
            }),
        });

        if (!res.ok) {
            const errBody = await res.text();
            console.log(`❌ FAILED — Status: ${res.status}`);
            console.log(`   Response: ${errBody.substring(0, 500)}`);
            return false;
        }

        const json = await res.json();
        const msg = json.choices?.[0]?.message;
        console.log(`✅ SUCCESS`);
        console.log(`   Reply: ${msg?.content || '(tool call)'}`);
        if (msg?.tool_calls?.length) {
            console.log(`   Tool calls: ${JSON.stringify(msg.tool_calls)}`);
        }
        return true;
    } catch (err) {
        console.log(`❌ FAILED — ${err.message}`);
        return false;
    }
}

// ── Test 2: Gemini via Google AI ──
async function testGemini() {
    console.log('\n═══ Test 2: Gemini (Google AI) ═══');
    console.log(`Model: ${GEMINI_MODEL}`);

    try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

        // Test simple chat
        const result = await model.generateContent('Say hello in one sentence.');
        const text = result.response.text();
        console.log(`✅ Simple chat works`);
        console.log(`   Reply: ${text}`);

        // Test with tools
        const chatSession = model.startChat({
            history: [],
            tools: TEST_TOOLS_GEMINI,
        });

        const toolResult = await chatSession.sendMessage('Add a task: buy milk tomorrow');
        const parts = toolResult.response.candidates?.[0]?.content?.parts || [];
        let hasToolCall = false;
        for (const part of parts) {
            if (part.functionCall) {
                hasToolCall = true;
                console.log(`✅ Tool calling works`);
                console.log(`   Tool: ${part.functionCall.name}`);
                console.log(`   Args: ${JSON.stringify(part.functionCall.args)}`);
            }
            if (part.text) {
                console.log(`   Text: ${part.text}`);
            }
        }
        if (!hasToolCall) {
            console.log(`⚠️  No tool call returned (got text reply instead — may be fine)`);
        }

        return true;
    } catch (err) {
        console.log(`❌ FAILED — ${err.message}`);
        return false;
    }
}

// ── Run ──
console.log('🧪 Nanobot LLM Test');
console.log('='.repeat(40));

const kimiOk = await testKimi();
const geminiOk = await testGemini();

console.log('\n' + '='.repeat(40));
console.log(`Results: Kimi-K2 ${kimiOk ? '✅' : '❌'} | Gemini ${geminiOk ? '✅' : '❌'}`);

if (!kimiOk && !geminiOk) {
    console.log('\n⛔ Both LLMs failed. Check your API keys in .env');
    process.exit(1);
} else if (!kimiOk) {
    console.log('\n⚠️  Kimi-K2 failed but Gemini works. Bot will use Gemini as fallback.');
} else if (!geminiOk) {
    console.log('\n⚠️  Gemini failed but Kimi-K2 works. Confirmation layer will use simple prompts.');
}

process.exit(0);
