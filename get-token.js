/**
 * One-time script to obtain a Google OAuth2 refresh token.
 * Run: node get-token.js
 * Then open the URL in your browser, authorize, and paste the code back here.
 */
import { google } from 'googleapis';
import * as readline from 'readline';
import dotenv from 'dotenv';
dotenv.config();

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'          // Desktop-app redirect
);

// Add all scopes your nanobot needs
const SCOPES = [
    'https://mail.google.com/',                          // Gmail
    'https://www.googleapis.com/auth/documents',         // Google Docs
    'https://www.googleapis.com/auth/spreadsheets',      // Google Sheets
    'https://www.googleapis.com/auth/drive',             // Google Drive
    'https://www.googleapis.com/auth/tasks',             // Google Tasks
    'https://www.googleapis.com/auth/contacts',          // Google Contacts
    'https://www.googleapis.com/auth/calendar',          // Google Calendar
];

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',          // force refresh-token generation
    scope: SCOPES,
});

console.log('\n🔗  Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nAfter authorizing, Google will show you an authorization code.');
console.log('Copy that code and paste it below.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste authorization code here: ', async (code) => {
    try {
        const { tokens } = await oauth2Client.getToken(code.trim());
        console.log('\n✅  Success! Here are your tokens:\n');
        console.log('Refresh Token:', tokens.refresh_token);
        console.log('\n📋  Paste this into your .env file:');
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    } catch (err) {
        console.error('\n❌  Error exchanging code:', err.message);
    }
    rl.close();
});
