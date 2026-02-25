import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import logger from '../../utils/logger.js';

let whitelist = [];
let relations = {};

function loadConfigs() {
    try {
        const wlPath = path.join(process.cwd(), 'data', 'whitelist.json');
        if (fs.existsSync(wlPath)) {
            whitelist = JSON.parse(fs.readFileSync(wlPath, 'utf8'));
            logger.info({ count: whitelist.length }, 'WhatsApp whitelist loaded');
        }

        const relPath = path.join(process.cwd(), 'data', 'relations.json');
        if (fs.existsSync(relPath)) {
            relations = JSON.parse(fs.readFileSync(relPath, 'utf8'));
            logger.info({ size: Object.keys(relations).length }, 'WhatsApp relations loaded');
        }
    } catch (err) {
        logger.error({ err: err.message }, 'Failed to load WhatsApp configs');
    }
}

export function register(core) {
    loadConfigs();

    // Register a read-only bridge to prevent core engine warnings when it tries to reply
    core.addBridge('whatsapp', async (userId, text) => {
        logger.debug({ userId, text }, 'WhatsApp is in passive mode, swallowing reply');
    });

    const puppeteerConfig = {
        headless: true,
        // Strictly avoiding --single-process which causes frame detachment crashes
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--v1=1' // helps avoid gpu processes hanging around sometimes
        ]
    };

    // Auto-detect Termux / Android custom Chromium
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const client = new Client({
        authStrategy: new LocalAuth({ dataPath: path.join(process.cwd(), 'data', 'whatsapp-session') }),
        puppeteer: puppeteerConfig
    });

    client.on('qr', (qr) => {
        logger.info('WhatsApp QR Code received, please scan it:');
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
        logger.info('WhatsApp plugin connected successfully (READY state)');
    });

    // Listen to ALL messages (including those created by the host) to easily grab Group IDs
    client.on('message_create', async msg => {
        logger.debug({ from: msg.from, to: msg.to, whitelistLen: whitelist.length }, 'RAW WA MESSAGE RECEIVED (pre-whitelist)');

        // Whitelist Logic:
        // Groups (@g.us) can be in 'from' (incoming) or 'to' (outgoing).
        const isGroup = msg.from.endsWith('@g.us') || msg.to.endsWith('@g.us');
        const groupId = isGroup ? (msg.from.endsWith('@g.us') ? msg.from : msg.to) : null;

        if (isGroup && !whitelist.includes(groupId)) {
            logger.debug({ groupId }, 'WA Message dropped: Group not in whitelist');
            return; // completely silent passive drop
        }

        // Must explicitly only handle readable intent triggers (so mostly text or captions)
        const body = msg.body;
        if (!body || body.trim() === '') return;

        // Apply relationship context (Implicit Sender Context)
        const participant = msg.from.endsWith('@g.us') ? msg.author : (msg.from.endsWith('@c.us') || msg.from.endsWith('@lid') ? msg.from : msg.to);
        const senderRaw = participant ? participant.split('@')[0] : 'Unknown';

        // Dynamically fetch their WhatsApp profile name instead of relying purely on numbers
        let contactName = senderRaw;
        try {
            const contact = await msg.getContact();
            contactName = contact.pushname || contact.name || contact.shortName || senderRaw;
        } catch (e) {
            logger.debug('Could not fetch contact name');
        }

        const senderAlias = relations[participant] || (isGroup ? contactName : contactName);
        const enrichedText = `[From: ${senderAlias}]: ${body}`;

        logger.info({ from: msg.from, alias: senderAlias, textSample: body.substring(0, 30) }, 'Authorized WA Message Rx');

        try {
            // Signal 'whatsapp' source, and 'passive: true' ensures we don't query Gemini for non-tasks
            await core.handleMessage('whatsapp', msg.from, enrichedText, { passive: true });
        } catch (err) {
            logger.error({ err: err.message }, 'Error handling WA message in core');
        }
    });

    client.initialize().catch(err => {
        logger.error({ err: err.message }, 'WhatsApp initialization error');
    });
}
