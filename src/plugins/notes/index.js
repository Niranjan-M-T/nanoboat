import db from '../../db.js';
import logger from '../../utils/logger.js';

export function register(core) {
    core.addTool('note_tool', {
        description: `Manage local notes. Actions: save, search, list, delete.
- save: store info for future reference (content required, title/tags optional). Use for things to REMEMBER — ideas, meeting notes, facts. NOT for action items.
- search: find notes by keyword (query required)
- list: show recent notes
- delete: remove a note (id required). DESTRUCTIVE — requires confirmation.`,
        parameters: {
            action: { type: 'string', required: true, description: 'save | search | list | delete' },
            content: { type: 'string', description: 'Note content (for save)' },
            title: { type: 'string', description: 'Note title (for save)' },
            tags: { type: 'string', description: 'Comma-separated tags (for save)' },
            query: { type: 'string', description: 'Search keyword (for search)' },
            id: { type: 'string', description: 'Note ID (for delete)' },
        },
    }, async (args) => {
        const action = (args.action || '').toLowerCase();

        switch (action) {
            case 'save': {
                const result = db.prepare(
                    'INSERT INTO notes (title, content, tags) VALUES (?, ?, ?)'
                ).run(args.title || '', args.content || '', args.tags || '');
                return { id: result.lastInsertRowid, saved: true };
            }
            case 'search': {
                const notes = db.prepare(
                    "SELECT id, title, content, tags FROM notes WHERE content LIKE ? OR title LIKE ? OR tags LIKE ? ORDER BY updated_at DESC LIMIT 10"
                ).all(`%${args.query}%`, `%${args.query}%`, `%${args.query}%`);
                return notes.length ? notes : 'No notes found.';
            }
            case 'list': {
                const notes = db.prepare(
                    'SELECT id, title, content, tags FROM notes ORDER BY updated_at DESC LIMIT 10'
                ).all();
                return notes.length ? notes : 'No notes saved yet.';
            }
            case 'delete': {
                const result = db.prepare('DELETE FROM notes WHERE id = ?').run(parseInt(args.id));
                return result.changes ? `Note #${args.id} deleted.` : `Note #${args.id} not found.`;
            }
            default:
                return `Unknown action: ${action}. Use save, search, list, or delete.`;
        }
    });

    logger.info('Notes plugin loaded');
}
