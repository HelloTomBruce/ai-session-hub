// ============================================
// AI Session Hub 本地缓存层 Schema 定义
// 用于将各 Adapter 的原始数据增量同步到
// 统一 SQLite 缓存中，支持 FTS5 全文搜索。
// ============================================

export const SCHEMA_VERSION = 2

export const CREATE_SCHEMA_SQL = `
-- 元信息
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 会话缓存
CREATE TABLE IF NOT EXISTS sessions_cache (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  category TEXT DEFAULT 'cli',
  title TEXT NOT NULL DEFAULT '',
  cwd TEXT NOT NULL DEFAULT '',
  model TEXT,
  cost REAL,
  status TEXT,
  message_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  raw_location TEXT,
  summary TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  data_hash TEXT,
  ai_diagnosed INTEGER DEFAULT 0,
  distilled INTEGER DEFAULT 0,
  extra TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sessions_platform ON sessions_cache(platform);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions_cache(updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_distilled ON sessions_cache(distilled);

-- 消息缓存
CREATE TABLE IF NOT EXISTS messages_cache (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  thought TEXT DEFAULT '',
  tool_calls_json TEXT DEFAULT '[]',
  timestamp INTEGER,
  model TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages_cache(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages_cache(timestamp);

-- FTS5 全文搜索虚拟表（用 content= 外部内容表实现低耦合）
CREATE VIRTUAL TABLE IF NOT EXISTS fts_messages USING fts5(
  content,
  title,
  session_id UNINDEXED,
  platform UNINDEXED,
  role UNINDEXED,
  tokenize='unicode61'
);

-- 知识资产库 (Knowledge Vault / ADRs / Gotchas / Patterns)
CREATE TABLE IF NOT EXISTS knowledge_vault (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  platform TEXT NOT NULL,
  type TEXT NOT NULL,                -- 'ADR' | 'Gotcha' | 'Pattern' | 'Milestone'
  title TEXT NOT NULL,
  context TEXT DEFAULT '',
  decision TEXT DEFAULT '',
  consequence TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  score INTEGER DEFAULT 0,
  grade TEXT DEFAULT 'A',
  source_cwd TEXT DEFAULT '',
  raw_markdown TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_vault(type);
CREATE INDEX IF NOT EXISTS idx_knowledge_session ON knowledge_vault(session_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_updated ON knowledge_vault(updated_at);

-- 会话量化评估缓存 (Session Evaluations Cache)
CREATE TABLE IF NOT EXISTS session_evaluations (
  session_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  overall_score INTEGER NOT NULL,
  grade TEXT NOT NULL,
  category TEXT NOT NULL,
  is_worth_saving INTEGER NOT NULL,
  sub_scores_json TEXT DEFAULT '{}',
  signals_json TEXT DEFAULT '[]',
  summary_reason TEXT DEFAULT '',
  evaluated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, platform)
);
`.trim()

// 重建 FTS 索引（当大量消息变更后）
export const REBUILD_FTS_SQL = `
INSERT INTO fts_messages(fts_messages)
SELECT 'rebuild'
`.trim()

// 插入/更新 FTS 索引
export const UPSERT_FTS_SQL = `
INSERT INTO fts_messages(rowid, content, title, session_id, platform, role)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(rowid) DO UPDATE SET
  content = excluded.content,
  title = excluded.title,
  session_id = excluded.session_id,
  platform = excluded.platform,
  role = excluded.role
`.trim()

// 删除 FTS 条目
export const DELETE_FTS_SQL = `
DELETE FROM fts_messages WHERE session_id = ?
`.trim()

// 搜索
export const SEARCH_SQL = `
SELECT
  f.rowid,
  snippet(fts_messages, 0, '<mark>', '</mark>', '...', 48) AS snippet,
  f.content,
  f.title,
  f.session_id,
  f.platform,
  f.role,
  rank
FROM fts_messages f
WHERE fts_messages MATCH ?
ORDER BY rank
LIMIT ? OFFSET ?
`.trim()

export const SEARCH_COUNT_SQL = `
SELECT COUNT(*) as total
FROM fts_messages
WHERE fts_messages MATCH ?
`.trim()
