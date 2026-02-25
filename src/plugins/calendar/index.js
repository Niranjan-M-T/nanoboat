import { google } from 'googleapis';
import config from '../../utils/config.js';
import logger from '../../utils/logger.js';

let calendarApi;

function getAuth() {
    const oauth2 = new google.auth.OAuth2(
        config.googleClientId,
        config.googleClientSecret
    );
    oauth2.setCredentials({ refresh_token: config.googleRefreshToken });
    return oauth2;
}

function getCalendar() {
    if (!calendarApi) calendarApi = google.calendar({ version: 'v3', auth: getAuth() });
    return calendarApi;
}

export function register(core) {
    if (!config.googleClientId || !config.googleRefreshToken) {
        logger.warn('Calendar plugin skipped — OAuth not configured');
        return;
    }

    core.addTool('calendar_tool', {
        description: `Manage Google Calendar. Actions: list, create, update, delete.
- list: show upcoming events (days_ahead optional, default 7)
- create: schedule event (title + start required, end/description/location optional). Primary email auto-added as required guest.
- update: change event details (event_id required)
- delete: remove event (event_id required)
Start/end format: ISO datetime e.g. 2025-03-01T10:00:00`,
        parameters: {
            action: { type: 'string', required: true, description: 'list | create | update | delete' },
            title: { type: 'string', description: 'Event title (for create/update)' },
            start: { type: 'string', description: 'Start datetime ISO (for create/update)' },
            end: { type: 'string', description: 'End datetime ISO (for create/update, default: 1h after start)' },
            description: { type: 'string', description: 'Event description' },
            location: { type: 'string', description: 'Event location' },
            event_id: { type: 'string', description: 'Event ID (for update/delete)' },
            days_ahead: { type: 'string', description: 'Days to look ahead (for list, default: 7)' },
        },
    }, async (args) => {
        const action = (args.action || '').toLowerCase();
        // Fallback to 'primary' if gmailUserEmail not set, otherwise explicitly use the connected account's calendar
        const calId = config.gmailUserEmail || 'primary';

        switch (action) {
            case 'list': {
                const daysAhead = parseInt(args.days_ahead) || 7;
                const now = new Date();
                const until = new Date(now.getTime() + daysAhead * 86400000);

                const res = await getCalendar().events.list({
                    calendarId: calId,
                    timeMin: now.toISOString(),
                    timeMax: until.toISOString(),
                    maxResults: 10,
                    singleEvents: true,
                    orderBy: 'startTime',
                });

                const events = (res.data.items || []).map(e => ({
                    id: e.id,
                    title: e.summary || '(no title)',
                    start: e.start?.dateTime || e.start?.date,
                    end: e.end?.dateTime || e.end?.date,
                    location: e.location || '',
                }));
                return events.length ? events : 'No upcoming events.';
            }
            case 'create': {
                const startDate = new Date(args.start);
                if (isNaN(startDate.getTime())) {
                    return '❌ Invalid start time provided. Please provide a clear date and time.';
                }

                const endDate = args.end ? new Date(args.end) : new Date(startDate.getTime() + 3600000);

                const event = {
                    summary: args.title || 'Untitled Event',
                    start: { dateTime: startDate.toISOString() },
                    end: { dateTime: isNaN(endDate.getTime()) ? new Date(startDate.getTime() + 3600000).toISOString() : endDate.toISOString() },
                };

                if (args.description) event.description = args.description;
                if (args.location) event.location = args.location;

                // Add primaryEmail as an attendee if it's different so both see it
                const attendees = [];
                if (config.primaryEmail && config.primaryEmail !== calId) {
                    attendees.push({ email: config.primaryEmail, responseStatus: 'accepted' });
                }

                if (attendees.length > 0) event.attendees = attendees;

                const res = await getCalendar().events.insert({
                    calendarId: calId,
                    requestBody: event,
                    sendUpdates: 'all',
                });

                return {
                    id: res.data.id,
                    title: res.data.summary,
                    start: res.data.start?.dateTime,
                    link: res.data.htmlLink,
                    attendees: (res.data.attendees || []).map(a => a.email),
                };
            }
            case 'update': {
                const body = {};
                if (args.title) body.summary = args.title;
                if (args.start) body.start = { dateTime: new Date(args.start).toISOString() };
                if (args.end) body.end = { dateTime: new Date(args.end).toISOString() };
                if (args.description) body.description = args.description;
                if (args.location) body.location = args.location;

                if (Object.keys(body).length === 0) return 'Nothing to update.';

                await getCalendar().events.patch({
                    calendarId: calId,
                    eventId: args.event_id,
                    requestBody: body,
                });
                return 'Event updated.';
            }
            case 'delete': {
                await getCalendar().events.delete({
                    calendarId: calId,
                    eventId: args.event_id,
                });
                return 'Event deleted.';
            }
            default:
                return `Unknown action: ${action}. Use list, create, update, or delete.`;
        }
    });

    logger.info('Calendar plugin loaded');
}
