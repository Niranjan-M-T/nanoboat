import { google } from 'googleapis';
import config from '../../utils/config.js';
import logger from '../../utils/logger.js';

let driveApi;

function getAuth() {
    const oauth2 = new google.auth.OAuth2(
        config.googleClientId,
        config.googleClientSecret
    );
    oauth2.setCredentials({ refresh_token: config.googleRefreshToken });
    return oauth2;
}

function getDrive() {
    if (!driveApi) driveApi = google.drive({ version: 'v3', auth: getAuth() });
    return driveApi;
}

async function shareWithPrimary(fileId) {
    if (!config.primaryEmail) return;
    try {
        await getDrive().permissions.create({
            fileId,
            requestBody: { type: 'user', role: 'writer', emailAddress: config.primaryEmail },
            sendNotificationEmail: false,
        });
    } catch (err) {
        logger.debug({ err: err.message, fileId }, 'Share with primary failed (may already exist)');
    }
}

export function register(core) {
    if (!config.googleClientId || !config.googleRefreshToken) {
        logger.warn('Drive plugin skipped — OAuth not configured');
        return;
    }

    core.addTool('drive_tool', {
        description: `Manage Google Drive files. Actions: list, create_doc, create_sheet, delete.
- list: search/browse files (query optional, searches file names)
- create_doc: create a Google Doc (title required, content optional). Auto-shared with primary email.
- create_sheet: create a Google Sheet (title required). Auto-shared with primary email.
- delete: trash a file (file_id required)`,
        parameters: {
            action: { type: 'string', required: true, description: 'list | create_doc | create_sheet | delete' },
            title: { type: 'string', description: 'Name/title (for create)' },
            content: { type: 'string', description: 'Initial text content (for create_doc)' },
            query: { type: 'string', description: 'Search query (for list)' },
            file_id: { type: 'string', description: 'File ID (for delete)' },
        },
    }, async (args) => {
        const action = (args.action || '').toLowerCase();

        switch (action) {
            case 'list': {
                let q = 'trashed = false';
                if (args.query) {
                    // Split query into words, remove filler, match each word individually
                    const fillers = new Set(['my', 'the', 'a', 'an', 'to', 'in', 'for', 'of', 'sheet', 'doc', 'document', 'file', 'spreadsheet', 'folder']);
                    const words = args.query.split(/\s+/).filter(w => !fillers.has(w.toLowerCase()) && w.length > 1);
                    for (const word of words) {
                        q += ` and name contains '${word.replace(/'/g, "\\'")}'`;
                    }
                }

                const res = await getDrive().files.list({
                    q, pageSize: 10,
                    fields: 'files(id, name, mimeType, modifiedTime, webViewLink, owners, shared)',
                    orderBy: 'modifiedTime desc',
                    includeItemsFromAllDrives: true,
                    supportsAllDrives: true,
                });

                const files = (res.data.files || []).map(f => ({
                    id: f.id, name: f.name,
                    type: simplifyMime(f.mimeType),
                    modified: f.modifiedTime?.split('T')[0],
                    link: f.webViewLink,
                    owner: f.owners?.[0]?.emailAddress || 'unknown',
                    shared: f.shared || false,
                }));
                return files.length ? files : 'No files found.';
            }
            case 'create_doc': {
                const docs = google.docs({ version: 'v1', auth: getAuth() });
                const doc = await docs.documents.create({ requestBody: { title: args.title || 'Untitled' } });
                const docId = doc.data.documentId;

                if (args.content) {
                    await docs.documents.batchUpdate({
                        documentId: docId,
                        requestBody: { requests: [{ insertText: { location: { index: 1 }, text: args.content } }] },
                    });
                }
                await shareWithPrimary(docId);
                return { id: docId, title: args.title, link: `https://docs.google.com/document/d/${docId}/edit` };
            }
            case 'create_sheet': {
                const sheets = google.sheets({ version: 'v4', auth: getAuth() });
                const res = await sheets.spreadsheets.create({ requestBody: { properties: { title: args.title || 'Untitled' } } });
                const sheetId = res.data.spreadsheetId;
                await shareWithPrimary(sheetId);
                return { id: sheetId, title: args.title, link: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` };
            }
            case 'delete': {
                await getDrive().files.update({ fileId: args.file_id, requestBody: { trashed: true } });
                return 'File moved to trash.';
            }
            default:
                return `Unknown action: ${action}. Use list, create_doc, create_sheet, or delete.`;
        }
    });

    logger.info('Drive plugin loaded');
}

function simplifyMime(mime) {
    if (!mime) return 'file';
    if (mime.includes('document')) return 'doc';
    if (mime.includes('spreadsheet')) return 'sheet';
    if (mime.includes('folder')) return 'folder';
    if (mime.includes('pdf')) return 'pdf';
    return 'file';
}
