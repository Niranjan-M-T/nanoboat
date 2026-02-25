import db from '../db.js';

/**
 * Fetch structured data on-demand for LLM tool results.
 * These are NEVER injected into chat context automatically.
 * 
 * Note: Tasks are now in Google Tasks API, not SQLite.
 * Only notes remain as local structured data.
 */

export function getRecentNotes(limit = 10) {
    return db.prepare(
        'SELECT id, title, content, tags FROM notes ORDER BY updated_at DESC LIMIT ?'
    ).all(limit);
}

export function searchNotes(query) {
    return db.prepare(
        "SELECT id, title, content, tags FROM notes WHERE content LIKE ? OR title LIKE ? ORDER BY updated_at DESC LIMIT 10"
    ).all(`%${query}%`, `%${query}%`);
}
