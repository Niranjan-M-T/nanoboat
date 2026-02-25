import logger from './utils/logger.js';

let interval;

export function startMonitor(intervalMs = 60_000) {
    const log = () => {
        const mem = process.memoryUsage();
        logger.info({
            rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
            external: `${Math.round(mem.external / 1024 / 1024)}MB`,
        }, 'memory');
    };

    log(); // initial snapshot
    interval = setInterval(log, intervalMs);
    interval.unref(); // don't prevent process exit
}

export function stopMonitor() {
    if (interval) clearInterval(interval);
}
