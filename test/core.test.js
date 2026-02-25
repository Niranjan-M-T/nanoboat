import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert';
import Core from '../src/core.js';
import * as chat from '../src/memory/chat.js';

describe('Core Engine - Hybrid Intent Routing', () => {
    let core;
    let sentMessages = [];

    beforeEach(() => {
        core = new Core();
        sentMessages = [];

        // Mock the bridge to capture replies
        core.addBridge('test', async (userId, text) => {
            sentMessages.push({ userId, text });
        });
    });

    test('should execute tool directly if Intent Router identifies a safe tool (Early-out)', async () => {
        // Mock a safe tool
        let toolExecuted = false;
        core.addTool('safe_test_tool', {
            description: 'Safe tool',
            parameters: {}
        }, async () => {
            toolExecuted = true;
            return 'Safe action done';
        });

        // Mock intent router returning the tool intent
        core.setIntentRouter(async () => {
            return { intent: 'safe_test_tool', args: {} };
        });

        // Mock full LLM (should NOT be called)
        let fullLlmCalled = false;
        core.setLLM(async () => {
            fullLlmCalled = true;
            return { text: 'Full LLM Response' };
        });

        await core.handleMessage('test', 'user1', 'do the safe thing');

        assert.strictEqual(toolExecuted, true, 'Tool should have been executed');
        assert.strictEqual(fullLlmCalled, false, 'Full LLM should NOT have been called');
        assert.strictEqual(sentMessages.length, 1);
        assert.ok(sentMessages[0].text.includes('Safe action done'));
    });

    test('should fallback to Full LLM if Intent Router returns "chat"', async () => {
        // Mock intent router returning "chat"
        core.setIntentRouter(async () => {
            return { intent: 'chat', args: {} };
        });

        // Mock full LLM
        let fullLlmCalled = false;
        core.setLLM(async () => {
            fullLlmCalled = true;
            return { text: 'I am Gemini, how can I help?' };
        });

        await core.handleMessage('test', 'user1', 'hi there');

        assert.strictEqual(fullLlmCalled, true, 'Full LLM should have been called');
        assert.strictEqual(sentMessages.length, 1);
        assert.strictEqual(sentMessages[0].text, 'I am Gemini, how can I help?');
    });

    test('should ask for confirmation if Intent Router identifies a destructive tool', async () => {
        // Mock a destructive tool
        let toolExecuted = false;
        core.addTool('email_tool', {
            description: 'Send email',
            parameters: {}
        }, async () => {
            toolExecuted = true;
            return 'Email sent';
        });

        // Mock intent router returning the destructive tool intent
        core.setIntentRouter(async () => {
            return { intent: 'email_tool', args: { action: 'send', to: 'x@x.com' } };
        });

        // Mock confirmation LLM (or just use default fallback)
        core.setConfirmLLM(async () => {
            return 'Are you sure you want to send this email? (yes/no)';
        });

        await core.handleMessage('test', 'user1', 'send email to x');

        assert.strictEqual(toolExecuted, false, 'Tool should NOT execute immediately');
        assert.strictEqual(sentMessages.length, 1);
        assert.strictEqual(sentMessages[0].text, 'Are you sure you want to send this email? (yes/no)');
    });
});
