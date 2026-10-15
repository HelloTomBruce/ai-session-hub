/**
 * P3 召回质量闭环：记忆命中/使用/反馈统计（SQLite，独立于 Grafeo）。
 *
 * 表 memory_stats 按 memory_id 聚合：
 * - recall_count / last_recall_at：召回命中（出现在 recall 结果中）
 * - use_count / last_used_at：实际拉取详情（get_memory）
 * - useful / not_useful：Agent 显式反馈（MCP rate_memory）
 *
 * 排序融合在 memory-service.recallMemories 中消费（getMemoryQualityScore）。
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface MemoryStatsRow {
  memory_id: string
  recall_count: number
  use_count: number
  useful: number
  not_useful: number
  last_recall_at: number | null
  last_used_at: number | null
}

/** 召回事件（一次 recall 调用落一行），用于召回效果度量的曝光侧 */
export interface RecallEventInput {
  cwd?: string
  type?: string
  query?: string
  memoryIds: string[]
  count?: number
  source?: string
}

export interface RecallEventRow {
  id: number
  at: number
  cwd: string
  type: string
  query: string
  memory_ids_json: string
  count: number
  source: string
}

class RecallStatsService {
  private db: Database.Database | null = null

  private getDb(): Database.Database {
    if (this.db) return this.db
    const dir = path.join(os.homedir(), '.session-hub')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const dbPath = path.join(dir, 'recall-stats.db')
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_stats (
        memory_id TEXT PRIMARY KEY,
        recall_count INTEGER DEFAULT 0,
        use_count INTEGER DEFAULT 0,
        useful INTEGER DEFAULT 0,
        not_useful INTEGER DEFAULT 0,
        last_recall_at INTEGER,
        last_used_at INTEGER
      );

      -- 召回事件明细（曝光侧埋点）：每次 recall 调用一行，带 cwd 上下文用于效果度量归因
      CREATE TABLE IF NOT EXISTS recall_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        cwd TEXT DEFAULT '',
        type TEXT DEFAULT '',
        query TEXT DEFAULT '',
        memory_ids_json TEXT DEFAULT '[]',
        count INTEGER DEFAULT 0,
        source TEXT DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_recall_events_at ON recall_events(at);
      CREATE INDEX IF NOT EXISTS idx_recall_events_cwd ON recall_events(cwd);
    `)
    return this.db
  }

  /** 召回命中：一次 recall 返回的多条记忆各记一次 */
  logRecall(memoryIds: string[]): void {
    if (!memoryIds.length) return
    try {
      const db = this.getDb()
      const now = Date.now()
      const up = db.prepare(`
        INSERT INTO memory_stats (memory_id, recall_count, last_recall_at) VALUES (?, 1, ?)
        ON CONFLICT(memory_id) DO UPDATE SET recall_count = recall_count + 1, last_recall_at = ?
      `)
      const tx = db.transaction((ids: string[]) => {
        for (const id of ids) {
          up.run(id, now, now)
        }
      })
      tx(memoryIds)
    } catch (err) {
      console.error('[RecallStats] logRecall failed:', err)
    }
  }

  /** 实际使用：get_memory 拉取详情 */
  logUse(memoryId: string): void {
    try {
      const db = this.getDb()
      const now = Date.now()
      db.prepare(`
        INSERT INTO memory_stats (memory_id, use_count, last_used_at) VALUES (?, 1, ?)
        ON CONFLICT(memory_id) DO UPDATE SET use_count = use_count + 1, last_used_at = ?
      `).run(memoryId, now, now)
    } catch (err) {
      console.error('[RecallStats] logUse failed:', err)
    }
  }

  /** Agent 显式反馈（MCP rate_memory） */
  logFeedback(memoryId: string, useful: boolean): void {
    try {
      const db = this.getDb()
      const now = Date.now()
      // 列名白名单分支（避免动态拼接 SQL）
      if (useful) {
        db.prepare(`
          INSERT INTO memory_stats (memory_id, useful, last_used_at) VALUES (?, 1, ?)
          ON CONFLICT(memory_id) DO UPDATE SET useful = useful + 1, last_used_at = ?
        `).run(memoryId, now, now)
      } else {
        db.prepare(`
          INSERT INTO memory_stats (memory_id, not_useful, last_used_at) VALUES (?, 1, ?)
          ON CONFLICT(memory_id) DO UPDATE SET not_useful = not_useful + 1, last_used_at = ?
        `).run(memoryId, now, now)
      }
    } catch (err) {
      console.error('[RecallStats] logFeedback failed:', err)
    }
  }

  /**
   * 召回事件明细：记录一次 recall 调用的上下文（cwd/type/query/命中 id）。
   * 与 logRecall 的按 memory_id 聚合互补——聚合用于排序加权，明细用于效果度量归因。
   */
  logRecallEvent(input: RecallEventInput): void {
    try {
      const db = this.getDb()
      const ids = Array.isArray(input.memoryIds) ? input.memoryIds : []
      db.prepare(`
        INSERT INTO recall_events (at, cwd, type, query, memory_ids_json, count, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        Date.now(),
        input.cwd || '',
        input.type || '',
        input.query || '',
        JSON.stringify(ids),
        typeof input.count === 'number' ? input.count : ids.length,
        input.source || ''
      )
    } catch (err) {
      console.error('[RecallStats] logRecallEvent failed:', err)
    }
  }

  /** 读取指定时间之后的召回事件（召回效果度量分析用） */
  listEventsSince(since: number, limit = 1000): RecallEventRow[] {
    try {
      const db = this.getDb()
      return db.prepare(
        'SELECT * FROM recall_events WHERE at >= ? ORDER BY at DESC LIMIT ?'
      ).all(since, Math.max(1, Math.trunc(limit))) as RecallEventRow[]
    } catch {
      return []
    }
  }

  /** 删除指定来源的召回事件（清理试验/合成事件） */
  deleteEventsBySource(source: string): number {
    try {
      const db = this.getDb()
      return db.prepare('DELETE FROM recall_events WHERE source = ?').run(source).changes
    } catch {
      return 0
    }
  }

  getAll(): Map<string, MemoryStatsRow> {
    try {
      const db = this.getDb()
      const rows = db.prepare('SELECT * FROM memory_stats').all() as MemoryStatsRow[]
      return new Map(rows.map(r => [r.memory_id, r]))
    } catch {
      return new Map()
    }
  }
}

export const recallStats = new RecallStatsService()
