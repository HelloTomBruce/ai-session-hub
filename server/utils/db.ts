import { logger } from './logger'
/**
 * 唯一的 SQLite 连接入口（provider）。
 *
 * 约定：`server/utils` 下不要再出现 `new Database(...)` 直连 `~/.session-hub` 的代码，
 * 一律通过本模块拿连接。原因有三：
 *  1. 数据目录此前被 cache-service / tag-service / recall-stats 各自拼了一遍
 *     `path.join(os.homedir(), '.session-hub')`，测试无法隔离（会写用户真实库）；
 *  2. Schema 与迁移只应由一处拥有，否则「某张表这个进程没建」的故障排查成本极高；
 *  3. 连接级 pragma（WAL / busy_timeout / foreign_keys）集中设置，避免各模块不一致。
 *
 * 测试隔离：设置 `HUB_HOME` 环境变量即可把整个数据目录指向临时目录。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { SCHEMA_VERSION, CREATE_SCHEMA_SQL } from './cache-schema'

/** 数据目录：HUB_HOME 优先，否则 ~/.session-hub */
export function hubHome(): string {
  const override = process.env.HUB_HOME?.trim()
  return override ? path.resolve(override) : path.join(os.homedir(), '.session-hub')
}

/** 数据目录下的指定文件绝对路径 */
export function hubFile(fileName: string): string {
  return path.join(hubHome(), fileName)
}

const connections = new Map<string, Database.Database>()

/**
 * 打开（并缓存）数据目录下的一个 SQLite 连接。
 * 同一个 fileName 在进程内只打开一次；初始化回调在首次创建时执行。
 * 打开失败返回 null（调用方已有既成的降级路径），不抛异常中断请求。
 */
export function openHubDb(
  fileName: string,
  onInit?: (db: Database.Database) => void
): Database.Database | null {
  const cached = connections.get(fileName)
  if (cached) return cached

  try {
    const dir = hubHome()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const fullPath = path.join(dir, fileName)
    const db = new Database(fullPath)

    // WAL：并发读 + 单写；busy_timeout 让并发写等待而不是立刻抛 SQLITE_BUSY
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 10000')
    db.pragma('foreign_keys = ON')

    onInit?.(db)

    connections.set(fileName, db)
    return db
  } catch (err) {
    logger.error(`[DB] Failed to open ${fileName}:`, err)
    return null
  }
}

/**
 * 主库连接（会话缓存 / 标签 / 诊断索引 / 知识库）。
 * 首次调用时完成建表与版本迁移。
 */
export function getHubDb(): Database.Database | null {
  return openHubDb('session-hub.db', (db) => {
    const existed = hasSchema(db)
    if (!existed) {
      db.exec(CREATE_SCHEMA_SQL)
      setMeta(db, 'schema_version', String(SCHEMA_VERSION))
      logger.info(`[DB] Database initialized with schema v${SCHEMA_VERSION}`)
      return
    }
    migrate(db)
  })
}

/** 是否已经建过表（meta 表存在即视为已初始化） */
function hasSchema(db: Database.Database): boolean {
  const row = db.prepare(
    'SELECT name FROM sqlite_master WHERE type = \'table\' AND name = \'meta\''
  ).get() as { name: string } | undefined
  return Boolean(row)
}

function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value)
}

/**
 * 版本迁移。
 * 每个版本只做「从上一版到当前版」所需的最小幂等改动，最后统一跑 CREATE_SCHEMA_SQL
 * （全部语句都是 IF NOT EXISTS），保证新增表在旧库上也会被补建。
 */
function migrate(db: Database.Database): void {
  const row = db.prepare('SELECT value FROM meta WHERE key = \'schema_version\'').get() as { value: string } | undefined
  const currentVersion = row ? parseInt(row.value, 10) : 0
  if (!Number.isFinite(currentVersion)) return
  if (currentVersion >= SCHEMA_VERSION) return

  if (currentVersion < 3) {
    try {
      db.exec('DROP TABLE IF EXISTS fts_messages;')
      db.prepare('UPDATE sessions_cache SET data_hash = NULL;').run()
    } catch {
      // 旧库可能本就没有这张表，忽略
    }
  }

  if (currentVersion < 4) migrateSessionEvaluationsV4(db)
  if (currentVersion < 8) dropPrescriptionsV8(db)

  db.exec(CREATE_SCHEMA_SQL)
  setMeta(db, 'schema_version', String(SCHEMA_VERSION))
  logger.info(`[DB] Database migrated from v${currentVersion} to v${SCHEMA_VERSION}`)
}

/** v4：session_evaluations 增加 Rubric v2 字段（旧库 ALTER，幂等） */
function migrateSessionEvaluationsV4(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(session_evaluations)').all() as Array<{ name: string }>
  const existing = new Set(columns.map(c => c.name))
  // 预组合的静态 DDL（列名与定义均为编译期常量，避免运行时拼接 SQL）
  const additions: Array<[string, string]> = [
    ['strategy_json', 'ALTER TABLE session_evaluations ADD COLUMN strategy_json TEXT DEFAULT \'[]\''],
    ['flags_json', 'ALTER TABLE session_evaluations ADD COLUMN flags_json TEXT DEFAULT \'{}\''],
    ['evaluator_version', 'ALTER TABLE session_evaluations ADD COLUMN evaluator_version INTEGER DEFAULT 2'],
    ['harvest_status', 'ALTER TABLE session_evaluations ADD COLUMN harvest_status TEXT DEFAULT \'\''],
    ['memory_node_id', 'ALTER TABLE session_evaluations ADD COLUMN memory_node_id TEXT DEFAULT \'\''],
    ['evidence_hash', 'ALTER TABLE session_evaluations ADD COLUMN evidence_hash TEXT DEFAULT \'\'']
  ]
  for (const [name, ddl] of additions) {
    if (existing.has(name)) continue
    try {
      db.exec(ddl)
    } catch (err) {
      logger.error(`[DB] Failed to add column ${name}:`, err)
    }
  }
}

/** v8：移除已下线的 prescriptions 台账表（处方能力已整体移除） */
function dropPrescriptionsV8(db: Database.Database): void {
  try {
    db.exec('DROP TABLE IF EXISTS prescriptions')
  } catch (err) {
    logger.error('[DB] Failed to drop prescriptions table:', err)
  }
}

/** 关闭并清空所有连接（仅测试 / 进程退出时使用） */
export function closeAllHubDb(): void {
  for (const [name, db] of connections) {
    try {
      db.close()
    } catch (err) {
      logger.error(`[DB] Failed to close ${name}:`, err)
    }
  }
  connections.clear()
}

/** 当前已建立的连接数（诊断用） */
export function hubDbConnectionCount(): number {
  return connections.size
}
