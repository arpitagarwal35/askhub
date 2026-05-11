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
      results         TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ingested_pages (
      page_id     TEXT NOT NULL,
      source_type TEXT NOT NULL,
      collection  TEXT NOT NULL,
      ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (page_id, collection)
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

// ── Ingestion tracking ────────────────────────────────────────────────────────

export function isPageIngested(pageId, collection) {
  const row = db().prepare(
    "SELECT 1 FROM ingested_pages WHERE page_id = ? AND collection = ?"
  ).get(pageId, collection);
  return !!row;
}

export function markPageIngested(pageId, sourceType, collection) {
  db().prepare(
    "INSERT OR REPLACE INTO ingested_pages (page_id, source_type, collection) VALUES (?, ?, ?)"
  ).run(pageId, sourceType, collection);
}

export function getIngestionStats(collection) {
  return db().prepare(
    "SELECT COUNT(*) as pages, MAX(ingested_at) as last_synced_at FROM ingested_pages WHERE collection = ?"
  ).get(collection);
}

export function getIngestedPageIds(collection) {
  const rows = db().prepare(
    "SELECT page_id FROM ingested_pages WHERE collection = ?"
  ).all(collection);
  return new Set(rows.map((r) => r.page_id));
}

export function clearIngestionLog(collection) {
  db().prepare("DELETE FROM ingested_pages WHERE collection = ?").run(collection);
}
