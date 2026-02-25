import db from './db.js';
import Core from './core.js';
import { startMonitor } from './monitor.js';
import logger from './utils/logger.js';

// ── Plugins ──────────────────────────────────────
import { register as llm } from './plugins/llm/index.js';
import { register as telegram } from './plugins/telegram/index.js';
import { register as email } from './plugins/email/index.js';
import { register as googleWorkspace } from './plugins/google-workspace/index.js';
import { register as tasks } from './plugins/tasks/index.js';
import { register as calendar } from './plugins/calendar/index.js';
import { register as drive } from './plugins/drive/index.js';
import { register as notes } from './plugins/notes/index.js';
import { register as scheduler } from './plugins/scheduler/index.js';

// ── Boot ─────────────────────────────────────────

const core = new Core();
core.db = db;

// Register plugins in order (LLM first, then bridges, then tools)
const plugins = [
    ['llm', llm],
    ['telegram', telegram],
    ['email', email],
    ['google-workspace', googleWorkspace],
    ['tasks', tasks],
    ['calendar', calendar],
    ['drive', drive],
    ['notes', notes],
    ['scheduler', scheduler],
];

for (const [name, register] of plugins) {
    try {
        register(core);
    } catch (err) {
        logger.error({ err, plugin: name }, `Failed to load plugin: ${name}`);
    }
}

// Start memory monitor
startMonitor();

// Emit startup event
await core.emit('startup');

logger.info({
    tools: [...core.tools.keys()],
    bridges: [...core.bridges.keys()],
}, 'Nanobot started');

// ── Graceful shutdown ────────────────────────────

const shutdown = async () => {
    logger.info('Shutting down...');
    await core.emit('shutdown');
    db.close();
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
