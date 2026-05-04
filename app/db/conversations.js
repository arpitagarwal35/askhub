import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../../data/conversations.db");

let _db = null;

function db() {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    migrate(_db);
  }
  return _db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          TEXT PRIMARY KEY,
      workspace   TEXT NOT NULL DEFAULT 'default',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      role            TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content         TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS search_contexts (
      id              TEXT PRIMARY KEY,
      message_id      TEXT NOT NULL REFERENCES messages(id),
      query           TEXT NOT NULL,
      results         TEXT NOT NULL,  -- JSON array of retrieved chunks
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);
  `);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function createConversation(id, workspace = "default") {
  db().prepare(
    "INSERT OR IGNORE INTO conversations (id, workspace) VALUES (?, ?)"
  ).run(id, workspace);
}

export function addMessage(conversationId, messageId, role, content) {
  createConversation(conversationId);
  db().prepare(
    "INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)"
  ).run(messageId, conversationId, role, content);
}

export function saveSearchContext(messageId, query, results) {
  db().prepare(
    "INSERT INTO search_contexts (id, message_id, query, results) VALUES (?, ?, ?, ?)"
  ).run(crypto.randomUUID(), messageId, query, JSON.stringify(results));
}

export function getConversationHistory(conversationId, limit = 20) {
  return db().prepare(
    "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?"
  ).all(conversationId, limit);
}

export function listConversations(workspace = "default") {
  return db().prepare(
    "SELECT id, created_at FROM conversations WHERE workspace = ? ORDER BY created_at DESC LIMIT 50"
  ).all(workspace);
}
