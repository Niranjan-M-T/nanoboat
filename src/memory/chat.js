import db from '../db.js';

const MAX_WINDOW = 20;

/**
 * Append a message to chat history.
 * @param {string} userId
 * @param {'user'|'assistant'} role
 * @param {string} content
 */
export function append(userId, role, content) {
    db.prepare(
        'INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)'
    ).run(userId, role, content);

    // Trim to rolling window
    const count = db.prepare(
        'SELECT COUNT(*) as c FROM chat_messages WHERE user_id = ?'
    ).get(userId).c;

    if (count > MAX_WINDOW) {
        db.prepare(`
      DELETE FROM chat_messages WHERE id IN (
        SELECT id FROM chat_messages WHERE user_id = ?
        ORDER BY id ASC LIMIT ?
      )
    `).run(userId, count - MAX_WINDOW);
    }
}

/**
 * Get recent chat messages for LLM context.
 * @param {string} userId
 * @returns {{ role: string, content: string }[]}
 */
export function getHistory(userId) {
    return db.prepare(
        'SELECT role, content FROM chat_messages WHERE user_id = ? ORDER BY id ASC'
    ).all(userId);
}

/**
 * Clear chat history for a user.
 * @param {string} userId
 */
export function clear(userId) {
    db.prepare('DELETE FROM chat_messages WHERE user_id = ?').run(userId);
}
