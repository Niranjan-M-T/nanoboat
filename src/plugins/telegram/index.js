import { Bot } from 'grammy';
import config from '../../utils/config.js';
import logger from '../../utils/logger.js';

export function register(core) {
    const bot = new Bot(config.telegramBotToken);
    const allowed = config.telegramAllowedUsers;

    bot.on('message:text', async (ctx) => {
        const userId = String(ctx.from.id);

        // Filter by allowed users if configured
        if (allowed.length > 0 && !allowed.includes(userId)) {
            logger.warn({ userId }, 'Unauthorized Telegram user');
            return;
        }

        await core.handleMessage('telegram', userId, ctx.message.text);
    });

    // Register bridge for sending replies
    core.addBridge('telegram', async (userId, text) => {
        try {
            await bot.api.sendMessage(Number(userId), text, { parse_mode: 'Markdown' });
        } catch (err) {
            // Fallback: send without markdown if formatting fails
            if (err.message?.includes('parse')) {
                await bot.api.sendMessage(Number(userId), text);
            } else {
                logger.error({ err, userId }, 'Telegram send failed');
            }
        }
    });

    // Start polling
    bot.start({
        onStart: () => logger.info('Telegram bot started'),
    });

    // Graceful stop
    core.on('shutdown', () => bot.stop());

    logger.info('Telegram plugin loaded');
}
