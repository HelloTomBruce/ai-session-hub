import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'
import { adapterRegistry } from './adapter-registry'
import {
  SCHEMA_VERSION,
  CREATE_SCHEMA_SQL,
  SEARCH_SQL,
  SEARCH_COUNT_SQL,
  DELETE_FTS_SQL,
  REBUILD_FTS_SQL
} from './cache-schema'
import type { UnifiedSession, SessionMessage, PlatformType } from './types'

const DB_DIR = path.join(os.homedir(), '.session-hub')
const DB_PATH = path.join(DB_DIR, 'session-hub.db')

export interface SearchResult {
  rowid: number
  snippet: string
  content: string
  title: string
  session_id: string
  platform: string
  role: string
  rank: number
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
}

export interface CacheStats {
  sessions: number
  messages: number
  fts_entries: number
  last_sync_at: string | null
  schema_version: number | null
  db_exists: boolean
}

class CacheService {
  private db: Database.Database | null = null
  private initialized = false

  /**
   * 初始化数据库连接并确保 Schema
   */
  init(): void {
    if (this.initialized) return

    try {
      if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true })
      }

      const dbExists = fs.existsSync(DB_PATH)
      this.db = new Database(DB_PATH)

      // WAL 模式提升并发性能
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('foreign_keys = ON')

      if (!dbExists) {
        this.runSchema()
      } else {
        this.migrateSchema()
      }

      this.initialized = true
    } catch (err) {
      console.error('[Cache] Failed to initialize cache DB:', err)
      this.db = null
    }
  }

  /**
   * 创建初始 Schema
   */
  private runSchema(): void {
    if (!this.db) return
    this.db.exec(CREATE_SCHEMA_SQL)
    this.db.prepare(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)'
    ).run('schema_version', String(SCHEMA_VERSION))
    console.log('[Cache] Database initialized with schema v' + SCHEMA_VERSION)
  }

  /**
   * Schema 迁移（预留扩展）
   */
  private migrateSchema(): void {
    if (!this.db) return
    const row = this.db.prepare(
      "SELECT value FROM meta WHERE key = 'schema_version'"
    ).get() as { value: string } | undefined
    const currentVersion = row ? parseInt(row.value, 10) : 0

    if (currentVersion < SCHEMA_VERSION) {
      // 未来 migration 逻辑放在这里
      this.db.prepare(
        'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)'
      ).run('schema_version', String(SCHEMA_VERSION))
    }
  }

  /**
   * 检查缓存是否可用
   */
  isAvailable(): boolean {
    return this.initialized && this.db !== null
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    if (!this.db) {
      return {
        sessions: 0, messages: 0, fts_entries: 0,
        last_sync_at: null, schema_version: null,
        db_exists: fs.existsSync(DB_PATH)
      }
    }

    const sessions = (this.db.prepare(
      'SELECT COUNT(*) as c FROM sessions_cache'
    ).get() as { c: number }).c

    const messages = (this.db.prepare(
      'SELECT COUNT(*) as c FROM messages_cache'
    ).get() as { c: number }).c

    let fts_entries = 0
    try {
      fts_entries = (this.db.prepare(
        'SELECT COUNT(*) as c FROM fts_messages'
      ).get() as { c: number }).c
    } catch {
      fts_entries = 0
    }

    const lastSync = this.db.prepare(
      "SELECT value FROM meta WHERE key = 'last_sync_at'"
    ).get() as { value: string } | undefined

    const sv = this.db.prepare(
      "SELECT value FROM meta WHERE key = 'schema_version'"
    ).get() as { value: string } | undefined

    return {
      sessions, messages, fts_entries,
      last_sync_at: lastSync?.value || null,
      schema_version: sv ? parseInt(sv.value, 10) : null,
      db_exists: true
    }
  }

  /**
   * 计算会话的数据指纹（用于增量同步判断）
   */
  private computeHash(session: UnifiedSession, messages: SessionMessage[]): string {
    const hash = crypto.createHash('sha256')
    // 包含关键字段和消息摘要
    hash.update(session.title)
    hash.update(session.cwd)
    hash.update(String(session.updatedAt))
    hash.update(String(session.messageCount))
    hash.update(session.model || '')
    hash.update(session.status || '')
    // 最后几条消息的摘要（用于检测变化）
    const msgContents = messages.slice(-3).map(m => m.content.slice(0, 100)).join('')
    hash.update(msgContents)
    return hash.digest('hex').slice(0, 16) // 取前 16 位足够区分
  }

  /**
   * 全量或增量同步所有适配器的会话到缓存
   */
  syncAll(): { synced: number, total: number, errors: number } {
    this.init()
    if (!this.db) return { synced: 0, total: 0, errors: 1 }

    const adapters = adapterRegistry.getAllAdapters()
    let totalSessions = 0
    let syncedSessions = 0
    let errors = 0

    // 在事务中执行
    const syncTransaction = this.db.transaction(() => {
      for (const adapter of adapters) {
        if (!adapter.isAvailable()) continue

        try {
          const sessions = adapter.getSessions()
          totalSessions += sessions.length

          for (const session of sessions) {
            const messages = adapter.getMessages(session.id, session)
            const newHash = this.computeHash(session, messages)

            // 查询缓存中已有 hash
            const cached = this.db!.prepare(
              'SELECT data_hash FROM sessions_cache WHERE id = ? AND platform = ?'
            ).get(session.id, session.cli) as { data_hash: string } | undefined

            if (cached?.data_hash === newHash) {
              // 无变化，跳过
              continue
            }

            // 插入/更新 sessions_cache
            this.db!.prepare(`
              INSERT OR REPLACE INTO sessions_cache
                (id, platform, category, title, cwd, model, cost, status, message_count,
                 created_at, updated_at, raw_location, data_hash, extra)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              session.id, session.cli, session.category,
              session.title, session.cwd,
              session.model || null,
              session.cost || null,
              session.status || null,
              session.messageCount || 0,
              session.createdAt, session.updatedAt,
              session.rawLocation, newHash,
              session.extra ? JSON.stringify(session.extra) : '{}'
            )

            // 删除旧消息并重新插入
            this.db!.prepare(
              'DELETE FROM messages_cache WHERE session_id = ? AND platform = ?'
            ).run(session.id, session.cli)

            // 删除旧 FTS
            this.db!.prepare(DELETE_FTS_SQL).run(session.id)

            const insertMsg = this.db!.prepare(`
              INSERT INTO messages_cache
                (id, session_id, platform, role, content, thought, tool_calls_json, timestamp, model)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)

            const insertFts = this.db!.prepare(`
              INSERT INTO fts_messages(content, title, session_id, platform, role)
              VALUES (?, ?, ?, ?, ?)
            `)

            for (const msg of messages) {
              const msgId = msg.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
              const toolCallsStr = msg.toolCalls ? JSON.stringify(msg.toolCalls) : '[]'

              insertMsg.run(
                msgId, session.id, session.cli,
                msg.role, msg.content,
                msg.thought || null,
                toolCallsStr,
                msg.timestamp || null,
                msg.model || null
              )

              // 只索引 user 和 assistant 的内容
              if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
                const contentPreview = msg.content.slice(0, 3000)
                insertFts.run(
                  contentPreview, session.title,
                  session.id, session.cli, msg.role
                )
              }
            }

            syncedSessions++
          }
        } catch (err) {
          console.error(`[Cache] Error syncing adapter ${adapter.id}:`, err)
          errors++
        }
      }

      // 更新同步时间
      this.db!.prepare(
        'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)'
      ).run('last_sync_at', new Date().toISOString())
    })

    try {
      syncTransaction()
    } catch (err) {
      console.error('[Cache] Sync transaction failed:', err)
      errors++
    }

    return { synced: syncedSessions, total: totalSessions, errors }
  }

  /**
   * 从缓存中获取会话列表
   */
  getCachedSessions(platformFilter?: string, searchQuery?: string): UnifiedSession[] {
    this.init()
    if (!this.db) return []

    try {
      let sql = 'SELECT * FROM sessions_cache'
      const params: any[] = []
      const conditions: string[] = []

      if (platformFilter && platformFilter !== 'all') {
        conditions.push('platform = ?')
        params.push(platformFilter)
      }

      if (searchQuery) {
        conditions.push('(title LIKE ? OR cwd LIKE ? OR id LIKE ? OR model LIKE ?)')
        const like = `%${searchQuery}%`
        params.push(like, like, like, like)
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ')
      }

      sql += ' ORDER BY updated_at DESC'

      const rows = this.db.prepare(sql).all(...params) as any[]
      return rows.map(this.rowToSession).filter(Boolean) as UnifiedSession[]
    } catch (err) {
      console.error('[Cache] Error reading cached sessions:', err)
      return []
    }
  }

  /**
   * 从缓存中获取单个会话详情
   */
  getCachedSessionDetail(platform: PlatformType, id: string): {
    session: UnifiedSession | null
    messages: SessionMessage[]
  } {
    this.init()
    if (!this.db) return { session: null, messages: [] }

    try {
      const srow = this.db.prepare(
        'SELECT * FROM sessions_cache WHERE id = ? AND platform = ?'
      ).get(id, platform as string) as any

      if (!srow) return { session: null, messages: [] }

      const mrows = this.db.prepare(
        'SELECT * FROM messages_cache WHERE session_id = ? AND platform = ? ORDER BY timestamp ASC'
      ).all(id, platform as string) as any[]

      return {
        session: this.rowToSession(srow),
        messages: mrows.map(this.rowToMessage).filter(Boolean) as SessionMessage[]
      }
    } catch (err) {
      console.error('[Cache] Error reading cached session detail:', err)
      return { session: null, messages: [] }
    }
  }

  /**
   * FTS5 全文搜索
   */
  search(query: string, limit = 20, offset = 0): SearchResponse {
    this.init()
    if (!this.db || !query.trim()) {
      return { results: [], total: 0, query }
    }

    const empty: SearchResponse = { results: [], total: 0, query }

    try {
      // FTS5 查询语法转义
      const ftsQuery = this.escapeFtsQuery(query)

      const totalRow = this.db.prepare(SEARCH_COUNT_SQL).get(ftsQuery) as { total: number }
      const total = totalRow.total

      if (total === 0) return empty

      const rows = this.db.prepare(SEARCH_SQL).all(ftsQuery, limit, offset) as SearchResult[]
      return { results: rows, total, query }
    } catch (err) {
      console.error('[Cache] FTS5 search error:', err)
      return empty
    }
  }

  /**
   * 将用户输入转义为 FTS5 查询语法
   */
  private escapeFtsQuery(query: string): string {
    // 去除特殊字符，用 * 做前缀匹配
    return query
      .replace(/[^\w\u4e00-\u9fff]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(t => {
        // 对中文不做切分，直接短语查询
        if (/[\u4e00-\u9fff]/.test(t)) {
          return `"${t}"`
        }
        return `${t}*`
      })
      .join(' ')
  }

  private rowToSession(row: any): UnifiedSession | null {
    if (!row) return null
    return {
      id: row.id,
      cli: row.platform,
      category: row.category || 'cli',
      title: row.title || '',
      cwd: row.cwd || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count || 0,
      model: row.model || undefined,
      cost: row.cost || undefined,
      status: row.status || undefined,
      rawLocation: row.raw_location || '',
      extra: row.extra ? this.safeJsonParse(row.extra) : undefined
    }
  }

  private rowToMessage(row: any): SessionMessage | null {
    if (!row) return null
    return {
      id: row.id,
      role: row.role,
      content: row.content || '',
      thought: row.thought || undefined,
      toolCalls: row.tool_calls_json ? this.safeJsonParse(row.tool_calls_json) : undefined,
      timestamp: row.timestamp || undefined,
      model: row.model || undefined
    }
  }

  private safeJsonParse(str: string): any {
    try { return JSON.parse(str) } catch { return str }
  }
}

// 导出单例
export const cacheService = new CacheService()
