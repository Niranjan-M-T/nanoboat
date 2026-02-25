import { randomUUID } from 'crypto';
import db from './db.js';
import config from './utils/config.js';
import logger from './utils/logger.js';

const TIMEOUT = config.confirmationTimeoutMs;

// Tool+action combinations that require user confirmation
const DESTRUCTIVE_ACTIONS = {
    email_tool: new Set(['send']),
    task_tool: new Set(['complete', 'delete']),
    calendar_tool: new Set(['delete']),
    drive_tool: new Set(['delete']),
    note_tool: new Set(['delete']),
    write_sheet: new Set(['*']),  // always destructive
    write_doc: new Set(['*']),    // always destructive
};

/**
 * Check if a tool call needs confirmation.
 * @param {string} toolName
 * @param {object} args - the tool arguments (checks args.action)
 */
export function needsConfirmation(toolName, args = {}) {
    const actions = DESTRUCTIVE_ACTIONS[toolName];
    if (!actions) return false;
    if (actions.has('*')) return true;
    return actions.has((args.action || '').toLowerCase());
}

/**
 * Store a pending confirmation and return the prompt message.
 */
export function createConfirmation(source, userId, toolName, args, promptText) {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + TIMEOUT).toISOString();

    db.prepare(`
    INSERT INTO pending_confirmations (id, user_id, source, tool, args, prompt_text, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, source, toolName, JSON.stringify(args), promptText, expiresAt);

    logger.info({ id, tool: toolName, userId }, 'Confirmation pending');
    return id;
}

/**
 * Try to resolve a confirmation. Returns the pending action or null.
 */
export function resolveConfirmation(userId) {
    const row = db.prepare(`
    SELECT * FROM pending_confirmations
    WHERE user_id = ? AND expires_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1
  `).get(userId);

    if (!row) return null;

    // Delete it (one-time use)
    db.prepare('DELETE FROM pending_confirmations WHERE id = ?').run(row.id);

    return {
        tool: row.tool,
        args: JSON.parse(row.args),
        promptText: row.prompt_text,
    };
}

/**
 * Clean expired confirmations.
 */
export function cleanExpired() {
    const { changes } = db.prepare(
        "DELETE FROM pending_confirmations WHERE expires_at <= datetime('now')"
    ).run();
    if (changes > 0) logger.debug({ cleaned: changes }, 'Expired confirmations removed');
}
