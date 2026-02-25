import { extractIntent } from './src/plugins/llm/ollama_local.js';

const mockToolDefs = [
    {
        name: 'add_task',
        description: 'Create an actionable task with a deadline.',
        parameters: {
            title: { type: 'string', required: true },
            due: { type: 'string', description: 'ISO date, optional' }
        }
    },
    {
        name: 'email_tool',
        description: 'Send an email.',
        parameters: {
            to: { type: 'string', required: true },
            subject: { type: 'string', required: true },
            body: { type: 'string', required: true }
        }
    }
];

async function run() {
    console.log('Testing "Call me at 10pm" against smollm2:360m...');
    const result = await extractIntent("[From: Mom]: Call me at 10pm", mockToolDefs);
    console.log('Final Parsed Object:', JSON.stringify(result, null, 2));
}

run();
