import 'dotenv/config';
import logger from './logger.js';

const required = [
    'NVIDIA_NIM_API_KEY',
    'GOOGLE_AI_API_KEY',
    'TELEGRAM_BOT_TOKEN',
];

const missing = required.filter(k => !process.env[k]);
if (missing.length) {
    logger.error({ missing }, 'Missing required environment variables');
    process.exit(1);
}

const config = {
    // LLM
    nvidiaNimApiKey: process.env.NVIDIA_NIM_API_KEY,
    googleAiApiKey: process.env.GOOGLE_AI_API_KEY,
    primaryModel: process.env.PRIMARY_MODEL || 'kimi',
    kimiModelId: process.env.KIMI_MODEL_ID || 'moonshotai/kimi-k2-instruct',
    geminiModelId: process.env.GEMINI_MODEL_ID || 'gemini-2.5-flash',

    // Telegram
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramAllowedUsers: process.env.TELEGRAM_ALLOWED_USERS
        ? process.env.TELEGRAM_ALLOWED_USERS.split(',').map(s => s.trim())
        : [],

    // Gmail / Google Workspace
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
    gmailUserEmail: process.env.GMAIL_USER_EMAIL || '',
    primaryEmail: process.env.PRIMARY_EMAIL || '',
    googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,

    // Ollama Local LLM Config (For Intent Routing)
    ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/chat',
    ollamaModelId: process.env.OLLAMA_MODEL_ID || 'smollm2:360m',

    // Scheduler
    dailyDigestCron: process.env.DAILY_DIGEST_CRON || '0 9 * * *',
    reminderCheckCron: process.env.REMINDER_CHECK_CRON || '* * * * *',

    // System
    logLevel: process.env.LOG_LEVEL || 'info',
    port: parseInt(process.env.PORT || '3000', 10),
    confirmationTimeoutMs: parseInt(process.env.CONFIRMATION_TIMEOUT_MS || '300000', 10),
};

export default config;
