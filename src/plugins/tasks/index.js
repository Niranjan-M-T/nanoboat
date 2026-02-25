import { google } from 'googleapis';
import config from '../../utils/config.js';
import logger from '../../utils/logger.js';

let tasksApi;

function getAuth() {
    const oauth2 = new google.auth.OAuth2(
        config.googleClientId,
        config.googleClientSecret
    );
    oauth2.setCredentials({ refresh_token: config.googleRefreshToken });
    return oauth2;
}

function getTasks() {
    if (!tasksApi) tasksApi = google.tasks({ version: 'v1', auth: getAuth() });
    return tasksApi;
}

let defaultListId = null;
async function getDefaultListId() {
    if (defaultListId) return defaultListId;
    const res = await getTasks().tasklists.list({ maxResults: 1 });
    const lists = res.data.items || [];
    if (lists.length > 0) {
        defaultListId = lists[0].id;
    } else {
        const created = await getTasks().tasklists.insert({
            requestBody: { title: 'Nanobot Tasks' },
        });
        defaultListId = created.data.id;
    }
    return defaultListId;
}

export function register(core) {
    if (!config.googleClientId || !config.googleRefreshToken) {
        logger.warn('Tasks plugin skipped — OAuth not configured');
        return;
    }

    core.addTool('task_tool', {
        description: `Manage Google Tasks. Actions: add, list, complete, update, delete.
- add: create a task (title required, due_date optional as YYYY-MM-DD, notes optional)
- list: show pending tasks (show_completed=yes to include done)
- complete: mark task done (task_id required)
- update: change title/due_date/notes (task_id required)
- delete: remove a task (task_id required)`,
        parameters: {
            action: { type: 'string', required: true, description: 'add | list | complete | update | delete' },
            title: { type: 'string', description: 'Task title (for add/update)' },
            due_date: { type: 'string', description: 'Deadline YYYY-MM-DD (for add/update)' },
            notes: { type: 'string', description: 'Details (for add/update)' },
            task_id: { type: 'string', description: 'Task ID (for complete/update/delete)' },
            show_completed: { type: 'string', description: '"yes" to include completed (for list)' },
        },
    }, async (args) => {
        const listId = await getDefaultListId();
        const action = (args.action || '').toLowerCase();

        switch (action) {
            case 'add': {
                const body = { title: args.title || 'Untitled task' };
                if (args.due_date) {
                    try {
                        const d = new Date(args.due_date);
                        if (!isNaN(d.getTime())) body.due = d.toISOString();
                    } catch (e) {
                        logger.warn({ due_date: args.due_date }, 'Invalid due_date from Intent Router ignored');
                    }
                }
                if (args.notes) body.notes = args.notes;
                const res = await getTasks().tasks.insert({ tasklist: listId, requestBody: body });
                return { id: res.data.id, title: res.data.title, due: res.data.due, status: 'needsAction' };
            }
            case 'list': {
                const res = await getTasks().tasks.list({
                    tasklist: listId,
                    showCompleted: args.show_completed === 'yes',
                    showHidden: false,
                    maxResults: 20,
                });
                const tasks = (res.data.items || []).map(t => ({
                    id: t.id, title: t.title,
                    due: t.due ? t.due.split('T')[0] : null,
                    status: t.status, notes: t.notes || '',
                }));
                return tasks.length ? tasks : 'No tasks found.';
            }
            case 'complete': {
                await getTasks().tasks.patch({
                    tasklist: listId, task: args.task_id,
                    requestBody: { status: 'completed' },
                });
                return 'Task marked as done.';
            }
            case 'update': {
                const body = {};
                if (args.title) body.title = args.title;
                if (args.due_date) {
                    try {
                        const d = new Date(args.due_date);
                        if (!isNaN(d.getTime())) body.due = d.toISOString();
                    } catch (e) {
                        logger.warn({ due_date: args.due_date }, 'Invalid due_date from Intent Router ignored during update');
                    }
                }
                if (args.notes) body.notes = args.notes;
                if (Object.keys(body).length === 0) return 'Nothing to update.';
                await getTasks().tasks.patch({ tasklist: listId, task: args.task_id, requestBody: body });
                return 'Task updated.';
            }
            case 'delete': {
                await getTasks().tasks.delete({ tasklist: listId, task: args.task_id });
                return 'Task deleted.';
            }
            default:
                return `Unknown action: ${action}. Use add, list, complete, update, or delete.`;
        }
    });

    logger.info('Tasks plugin loaded (Google Tasks API)');
}
