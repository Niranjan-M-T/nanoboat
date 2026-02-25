import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import path from 'path';

console.log('Starting standalone WhatsApp test...');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(process.cwd(), 'data', 'whatsapp-session') }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--v1=1'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('QR Code received, please scan it:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp Client is READY');
    console.log('Send a message to any group right now. Listening for ALL events...');
});

client.on('message', async msg => {
    console.log('\n[EVENT: message] Incoming mapped data:');
    console.log(`  from: ${msg.from}`);
    console.log(`  to: ${msg.to}`);
    console.log(`  body: ${msg.body.substring(0, 50)}...`);
});

client.on('message_create', async msg => {
    console.log('\n[EVENT: message_create] Any mapped data:');
    console.log(`  from: ${msg.from}`);
    console.log(`  to: ${msg.to}`);
    console.log(`  isGroup: ${msg.from.endsWith('@g.us') || msg.to.endsWith('@g.us')}`);
    console.log(`  body: ${msg.body.substring(0, 50)}...`);
});

client.initialize().catch(err => {
    console.error('Initialization error:', err);
});
