// ============================================
// AI Session Hub 本地缓存层 Schema 定义
// 用于将各 Adapter 的原始数据增量同步到
// 统一 SQLite 缓存中，支持 FTS5 全文搜索。
// ============================================

export const SCHEMA_VERSION = 8

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

-- FTS5 全文搜索虚拟表（增强字段：支持 message_id 锚点、tool_summary 工具调用、cwd 路径、tags 标签与中英文分词）
CREATE VIRTUAL TABLE IF NOT EXISTS fts_messages USING fts5(
  content,
  title,
  tool_summary,
  cwd,
  tags,
  message_id UNINDEXED,
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
  -- Rubric v2 (schema v4)
  strategy_json TEXT DEFAULT '[]',      -- 各策略原始分/confidence/信号
  flags_json TEXT DEFAULT '{}',         -- veto flags
  evaluator_version INTEGER DEFAULT 2,
  harvest_status TEXT DEFAULT '',       -- '' | 'candidate' | 'extracted' | 'skipped'
  memory_node_id TEXT DEFAULT '',       -- 抽取写入的 Grafeo 节点 id
  evidence_hash TEXT DEFAULT '',        -- 消息指纹（LLM 缓存复用）
  evaluated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, platform)
);

-- 会话诊断索引 (Diagnosis Index)：把诊断报告（含确定性 rubric）落库，
-- 作为召回效果度量的「结果侧」数据集（可 JOIN cwd / 时间）。
CREATE TABLE IF NOT EXISTS session_diagnoses (
  session_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  cwd TEXT DEFAULT '',
  score INTEGER,
  grade TEXT DEFAULT '',
  decision_soundness INTEGER,
  directness INTEGER,
  turn_velocity INTEGER,
  action_density INTEGER,
  friction_events_json TEXT DEFAULT '[]',   -- deductions（摩擦事件明细）
  source TEXT DEFAULT '',                   -- user_configured_llm | rubric_engine | report | backfill
  diagnosed_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_session_diagnoses_at ON session_diagnoses(diagnosed_at);
CREATE INDEX IF NOT EXISTS idx_session_diagnoses_cwd ON session_diagnoses(cwd);
`.trim()

// 插入/更新 FTS 索引
export const INSERT_FTS_SQL = `
INSERT INTO fts_messages(content, title, tool_summary, cwd, tags, message_id, session_id, platform, role)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`.trim()

// 删除 FTS 条目
export const DELETE_FTS_SQL = `
DELETE FROM fts_messages WHERE session_id = ?
`.trim()
