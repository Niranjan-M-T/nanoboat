import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from './utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

const dbPath = join(DATA_DIR, 'nanobot.db');
const db = new Database(dbPath);

// Performance pragmas for Pi
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// ── Core tables ──────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    role        TEXT NOT NULL,          -- 'user' | 'assistant'
    content     TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pending_confirmations (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    source      TEXT NOT NULL,
    tool        TEXT NOT NULL,
    args        TEXT NOT NULL,           -- JSON
    prompt_text TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    due_date    TEXT,
    priority    TEXT DEFAULT 'medium',   -- low | medium | high
    status      TEXT DEFAULT 'pending',  -- pending | done
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT DEFAULT '',
    content     TEXT NOT NULL,
    tags        TEXT DEFAULT '',          -- comma-separated
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );
`);

logger.info({ path: dbPath }, 'Database initialized');

export default db;
