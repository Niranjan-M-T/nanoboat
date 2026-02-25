import { google } from 'googleapis';
import config from '../../utils/config.js';
import logger from '../../utils/logger.js';

let gmail;

function getAuth() {
    const oauth2 = new google.auth.OAuth2(
        config.googleClientId,
        config.googleClientSecret
    );
    oauth2.setCredentials({ refresh_token: config.googleRefreshToken });
    return oauth2;
}

function getGmail() {
    if (!gmail) gmail = google.gmail({ version: 'v1', auth: getAuth() });
    return gmail;
}

export function register(core) {
    if (!config.googleClientId || !config.googleRefreshToken) {
        logger.warn('Email plugin skipped — Google OAuth not configured');
        return;
    }

    core.addTool('email_tool', {
        description: `Manage Gmail. Actions: read, search, send.
- read: get recent unread emails
- search: find emails by query (query required)
- send: compose and send email (to, subject, body required). DESTRUCTIVE — requires confirmation.`,
        parameters: {
            action: { type: 'string', required: true, description: 'read | search | send' },
            query: { type: 'string', description: 'Gmail search query (for search)' },
            to: { type: 'string', description: 'Recipient email (for send)' },
            subject: { type: 'string', description: 'Email subject (for send)' },
            body: { type: 'string', description: 'Email body plain text (for send)' },
        },
        destructive: true,
    }, async (args) => {
        const action = (args.action || '').toLowerCase();
        const gm = getGmail();

        switch (action) {
            case 'read': {
                const res = await gm.users.messages.list({ userId: 'me', q: 'is:unread', maxResults: 5 });
                if (!res.data.messages?.length) return 'No unread emails.';
                return fetchEmailSummaries(gm, res.data.messages);
            }
            case 'search': {
                const res = await gm.users.messages.list({ userId: 'me', q: args.query || '', maxResults: 5 });
                if (!res.data.messages?.length) return 'No emails found.';
                return fetchEmailSummaries(gm, res.data.messages);
            }
            case 'send': {
                const raw = Buffer.from(
                    `To: ${args.to}\r\nSubject: ${args.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${args.body}`
                ).toString('base64url');
                await gm.users.messages.send({ userId: 'me', requestBody: { raw } });
                return `Email sent to ${args.to} with subject "${args.subject}"`;
            }
            default:
                return `Unknown action: ${action}. Use read, search, or send.`;
        }
    });

    logger.info('Email plugin loaded');
}

async function fetchEmailSummaries(gm, messages) {
    const emails = [];
    for (const msg of messages) {
        const detail = await gm.users.messages.get({
            userId: 'me', id: msg.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
        });
        const headers = detail.data.payload.headers;
        emails.push({
            from: headers.find(h => h.name === 'From')?.value || '',
            subject: headers.find(h => h.name === 'Subject')?.value || '',
            date: headers.find(h => h.name === 'Date')?.value || '',
            snippet: detail.data.snippet,
        });
    }
    return emails;
}
