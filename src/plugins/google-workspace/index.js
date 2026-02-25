import { google } from 'googleapis';
import config from '../../utils/config.js';
import logger from '../../utils/logger.js';

let sheets, docs;

function getAuth() {
    const oauth2 = new google.auth.OAuth2(
        config.googleClientId,
        config.googleClientSecret
    );
    oauth2.setCredentials({ refresh_token: config.googleRefreshToken });
    return oauth2;
}

function getSheets() {
    if (!sheets) sheets = google.sheets({ version: 'v4', auth: getAuth() });
    return sheets;
}

function getDocs() {
    if (!docs) docs = google.docs({ version: 'v1', auth: getAuth() });
    return docs;
}

export function register(core) {
    if (!config.googleClientId || !config.googleRefreshToken) {
        logger.warn('Google Workspace plugin skipped — OAuth not configured');
        return;
    }

    // ── Sheets ────────────────────────────────────

    core.addTool('read_sheet', {
        description: 'Read data from a Google Sheet. Use when user asks to VIEW or GET spreadsheet data.',
        parameters: {
            spreadsheetId: { type: 'string', required: true, description: 'Google Sheet ID (from URL)' },
            range: { type: 'string', required: true, description: 'A1 notation range, e.g. "Sheet1!A1:D10"' },
        },
    }, async (args) => {
        const res = await getSheets().spreadsheets.values.get({
            spreadsheetId: args.spreadsheetId,
            range: args.range,
        });
        return res.data.values || [];
    });

    core.addTool('write_sheet', {
        description: 'Write data to a Google Sheet. Use ONLY when user explicitly asks to UPDATE or WRITE spreadsheet data.',
        parameters: {
            spreadsheetId: { type: 'string', required: true },
            range: { type: 'string', required: true, description: 'A1 notation range' },
            values: { type: 'string', required: true, description: '2D array of values as JSON string, e.g. [["A","B"],["C","D"]]' },
        },
        destructive: true,
    }, async (args) => {
        const values = typeof args.values === 'string' ? JSON.parse(args.values) : args.values;
        await getSheets().spreadsheets.values.update({
            spreadsheetId: args.spreadsheetId,
            range: args.range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values },
        });
        return `Sheet updated: ${args.range}`;
    });

    // ── Docs ──────────────────────────────────────

    core.addTool('read_doc', {
        description: 'Read content from a Google Doc. Use when user asks to VIEW or READ a document.',
        parameters: {
            documentId: { type: 'string', required: true, description: 'Google Doc ID (from URL)' },
        },
    }, async (args) => {
        const res = await getDocs().documents.get({ documentId: args.documentId });
        // Extract text from document body
        const body = res.data.body?.content || [];
        let text = '';
        for (const el of body) {
            if (el.paragraph) {
                for (const pe of el.paragraph.elements || []) {
                    if (pe.textRun) text += pe.textRun.content;
                }
            }
        }
        return text || '(empty document)';
    });

    core.addTool('write_doc', {
        description: 'Append text to a Google Doc. Use ONLY when user explicitly asks to WRITE or ADD to a document.',
        parameters: {
            documentId: { type: 'string', required: true },
            text: { type: 'string', required: true, description: 'Text to append' },
        },
        destructive: true,
    }, async (args) => {
        await getDocs().documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
                requests: [{
                    insertText: {
                        location: { index: 1 },
                        text: args.text + '\n',
                    },
                }],
            },
        });
        return `Text appended to document.`;
    });

    logger.info('Google Workspace plugin loaded');
}
