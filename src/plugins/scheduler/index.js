import cron from 'node-cron';
import { google } from 'googleapis';
import config from '../../utils/config.js';
import logger from '../../utils/logger.js';
import { cleanExpired } from '../../confirm.js';

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

export function register(core) {
    // ── Check due tasks every minute ──────────────

    cron.schedule(config.reminderCheckCron, async () => {
        try {
            // Fetch tasks due within the next hour from Google Tasks
            const res = await getTasks().tasklists.list({ maxResults: 1 });
            const lists = res.data.items || [];
            if (lists.length === 0) return;

            const listId = lists[0].id;
            const tasksRes = await getTasks().tasks.list({
                tasklist: listId,
                showCompleted: false,
                showHidden: false,
                maxResults: 50,
            });

            const now = new Date();
            const tasks = (tasksRes.data.items || []).filter(t => {
                if (!t.due) return false;
                const due = new Date(t.due);
                const diffMs = due.getTime() - now.getTime();
                // Due within next 60 seconds or just overdue (within last 60 seconds)
                return diffMs <= 60000 && diffMs > -60000;
            });

            for (const task of tasks) {
                const msg = `⏰ **Reminder:** ${task.title}\nDue: ${task.due?.split('T')[0]}`;
                for (const [source] of core.bridges) {
                    for (const userId of config.telegramAllowedUsers) {
                        core.sendProactive(source, userId, msg);
                    }
                }
            }
        } catch (err) {
            logger.debug({ err: err.message }, 'Scheduler task check failed');
        }

        // Also clean expired confirmations
        cleanExpired();
    });

    // ── Daily digest ──────────────────────────────

    cron.schedule(config.dailyDigestCron, async () => {
        try {
            const res = await getTasks().tasklists.list({ maxResults: 1 });
            const lists = res.data.items || [];
            if (lists.length === 0) return;

            const listId = lists[0].id;
            const tasksRes = await getTasks().tasks.list({
                tasklist: listId,
                showCompleted: false,
                showHidden: false,
                maxResults: 20,
            });

            const tasks = tasksRes.data.items || [];
            if (tasks.length === 0) return;

            let digest = '📋 **Daily Task Digest**\n\n';
            for (const t of tasks) {
                const due = t.due ? ` (due: ${t.due.split('T')[0]})` : '';
                digest += `• ${t.title}${due}\n`;
            }

            // Also fetch today's calendar events
            try {
                const calApi = google.calendar({ version: 'v3', auth: getAuth() });
                const now = new Date();
                const eod = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

                const eventsRes = await calApi.events.list({
                    calendarId: 'primary',
                    timeMin: now.toISOString(),
                    timeMax: eod.toISOString(),
                    singleEvents: true,
                    orderBy: 'startTime',
                    maxResults: 10,
                });

                const events = eventsRes.data.items || [];
                if (events.length > 0) {
                    digest += '\n📅 **Today\'s Events**\n\n';
                    for (const e of events) {
                        const start = e.start?.dateTime || e.start?.date || '';
                        const time = start.includes('T') ? start.split('T')[1].substring(0, 5) : 'all day';
                        digest += `• ${time} — ${e.summary || '(no title)'}\n`;
                    }
                }
            } catch {
                // Calendar not available — skip
            }

            for (const [source] of core.bridges) {
                for (const userId of config.telegramAllowedUsers) {
                    core.sendProactive(source, userId, digest);
                }
            }
        } catch (err) {
            logger.debug({ err: err.message }, 'Daily digest failed');
        }
    });

    logger.info('Scheduler plugin loaded');
}
