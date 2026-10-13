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
      )
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
