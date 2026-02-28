import * as kimi from './kimi.js';
import * as gemini from './gemini.js';
import * as intentExtractor from './ollama_local.js';
import logger from '../../utils/logger.js';

/**
 * LLM Plugin
 *
 * - Primary chat: Gemini 2.5 Flash (via Google AI)
 * - Fallback chat: Kimi-K2 (via NVIDIA NIM) — currently unreliable
 * - Confirmation prompts: Gemini
 * - Follow-up (agentic loop): Gemini
 * - Intent Router: Deterministic (Rule Router + Chrono-node, zero LLM)
 */
export function register(core) {
    // Primary chat function: Gemini with Kimi fallback
    const chatFn = async (messages, toolDefs) => {
        try {
            return await gemini.chat(messages, toolDefs);
        } catch (err) {
            logger.error({ err: err.message, status: err.status }, 'Gemini primary failed, falling back to Kimi-K2');

            try {
                return await kimi.chat(messages, toolDefs);
            } catch (fallbackErr) {
                logger.error({ err: fallbackErr }, 'Both LLMs failed');
                throw fallbackErr;
            }
        }
    };

    core.setLLM(chatFn);

    // Gemini as confirmation layer
    core.setConfirmLLM(gemini.generateConfirmation);

    // Gemini as fast follow-up for agentic tool loop
    core.setFollowUpLLM(gemini.chat);

    // Deterministic Intent Router (no LLM needed)
    core.setIntentRouter(async (text, toolDefs) => {
        return intentExtractor.extractIntent(text, toolDefs);
    });

    logger.info('LLM plugin loaded (primary: Gemini, fallback: Kimi-K2, local: Deterministic)');
}
