import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'
import { pluginManager } from './plugin-manager'
import { logPluginEvent } from './plugin-log'
import {
  SCHEMA_VERSION,
  CREATE_SCHEMA_SQL,
  INSERT_FTS_SQL,
  DELETE_FTS_SQL
} from './cache-schema'
import { tagService } from './tag-service'
import type { SessionToolCall, UnifiedSession, SessionMessage, PlatformType } from './types'

const DB_DIR = path.join(os.homedir(), '.session-hub')
const DB_PATH = path.join(DB_DIR, 'session-hub.db')

/** 单条 FTS 索引内容上限；超长消息按此大小分块建多条索引（L5） */
const FTS_CHUNK_SIZE = 50000

/**
 * 生成会话内唯一的缓存消息 id。
 * 适配器可能产出重复/缺失的 message id（如 AGY 缺失 step_index），
 * 直接拼接会导致 INSERT OR REPLACE 主键冲突折叠丢消息（M5）。
 */
function uniqueMsgId(used: Set<string>, rawId: string, idx: number): string {
  let id = rawId
  if (used.has(id)) {
    id = `${rawId}#${idx}`
  }
  while (used.has(id)) {
    id = `${id}_${idx}`
  }
  used.add(id)
  return id
}

interface SessionCacheRow {
  id: string
  platform: string
  category?: string
  title?: string
  cwd?: string
  created_at: number
  updated_at: number
  message_count?: number
  model?: string | null
  cost?: number | null
  status?: string | null
  raw_location?: string
  extra?: string
  tags?: string
}

interface MessageCacheRow {
  id: string
  role: string
  content?: string
  thought?: string | null
  tool_calls_json?: string | null
  timestamp?: number | null
  model?: string | null
}

export interface SearchResultItem {
  rowid: number
  message_id: string
  session_id: string
  platform: string
  role: string
  title: string
  cwd: string
  tags: string[]
  updated_at: number
  snippet: string
  tool_summary?: string
  rank: number
}

export interface SessionGroupedSearchResult {
  session_id: string
  platform: string
  title: string
  cwd: string
  tags: string[]
  updated_at: number
  matchedCount: number
  bestRank: number
  snippets: Array<{
    message_id: string
    role: string
    snippet: string
  }>
}

export interface SearchOptions {
  platform?: string
  role?: string
  cwd?: string
  tag?: string
  limit?: number
  offset?: number
  groupBy?: 'session' | 'message'
}

export interface SearchResponse {
  results: SearchResultItem[]
  groupedSessions?: SessionGroupedSearchResult[]
  total: number
  query: string
  page: number
  pageSize: number
  platforms?: Record<string, number>
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
  private segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

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
   * 获取底层 SQLite 数据库连接
   */
  getDb(): Database.Database | null {
    this.init()
    return this.db
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
   * Schema 迁移（版本升级）
   */
  private migrateSchema(): void {
    if (!this.db) return
    const row = this.db.prepare(
      'SELECT value FROM meta WHERE key = \'schema_version\''
    ).get() as { value: string } | undefined
    const currentVersion = row ? parseInt(row.value, 10) : 0

    if (currentVersion < SCHEMA_VERSION) {
      if (currentVersion < 4) {
        // v3 -> v4（TOMB-21）：旧 FTS 索引 message_id 存的是 rawMsgId，
        // 与 messages_cache 复合 id 不一致，必须重建索引；
        // data_hash 置空强制下一次 sync 全量重同步并重建 FTS
        try {
          this.db.exec('DROP TABLE IF EXISTS fts_messages;')
          this.db.prepare('UPDATE sessions_cache SET data_hash = NULL;').run()
        } catch {
          // ignore drop errors
        }
      }

      this.db.exec(CREATE_SCHEMA_SQL)
      this.db.prepare(
        'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)'
      ).run('schema_version', String(SCHEMA_VERSION))
      console.log(`[Cache] Database migrated from v${currentVersion} to v${SCHEMA_VERSION}`)
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

    let fts_entries: number
    try {
      fts_entries = (this.db.prepare(
        'SELECT COUNT(*) as c FROM fts_messages'
      ).get() as { c: number }).c
    } catch {
      fts_entries = 0
    }

    const lastSync = this.db.prepare(
      'SELECT value FROM meta WHERE key = \'last_sync_at\''
    ).get() as { value: string } | undefined

    const sv = this.db.prepare(
      'SELECT value FROM meta WHERE key = \'schema_version\''
    ).get() as { value: string } | undefined

    return {
      sessions, messages, fts_entries,
      last_sync_at: lastSync?.value || null,
      schema_version: sv ? parseInt(sv.value, 10) : null,
      db_exists: true
    }
  }

  /**
   * 中英文分词辅助
   */
  segmentText(text: string): string {
    if (!text) return ''
    try {
      const segments = Array.from(this.segmenter.segment(text))
      return segments
        .map(s => s.segment)
        .filter(s => s.trim().length > 0)
        .join(' ')
    } catch {
      return text
    }
  }

  /**
   * 提取 Tool Calls 关键摘要（用于全文检索）
   */
  private extractToolSummary(toolCalls?: SessionToolCall[]): string {
    if (!toolCalls || !toolCalls.length) return ''
    const parts: string[] = []
    for (const tool of toolCalls) {
      const name = tool.name || tool.type || ''
      if (name) parts.push(name)
      const args = tool.arguments || tool.args || tool.input
      if (args && typeof args === 'object') {
        const str = JSON.stringify(args)
        // 提取有价值的路径或命令片段
        const matches = str.match(/[\w\-./\\]+\.(?:[a-zA-Z0-9]{1,10})/g)
        if (matches) parts.push(...matches)
        const cmdMatches = str.match(/["'](?:command|cmd|script)["']:\s*["']([^"']+)["']/i)
        if (cmdMatches && cmdMatches[1]) parts.push(cmdMatches[1])
      }
    }
    return parts.slice(0, 15).join(' ')
  }

  /**
   * 计算会话内容 Hash（用于增量比对）
   */
  private computeHash(session: UnifiedSession): string {
    const raw = JSON.stringify({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      messageCount: session.messageCount,
      cwd: session.cwd,
      extra: session.extra
    })
    return crypto.createHash('sha256').update(raw).digest('hex')
  }

  /**
   * 执行全量/增量同步
   * - 每个插件读取失败自动重试一次（L7）
   * - 单会话消息解析失败不再中断整个插件同步
   * - 同步结束后对「源端已消失」的会话做 prune（H4），且仅针对本次同步成功的插件
   */
  sync(): { synced: number, total: number, errors: number } {
    this.init()
    if (!this.db) {
      return { synced: 0, total: 0, errors: 1 }
    }

    let syncedSessions = 0
    let totalSessions = 0
    let errors = 0

    const plugins = pluginManager.getActivePlugins()
    /** 本次同步成功的插件 id，仅这些平台参与 prune */
    const succeededPlugins = new Set<string>()
    /** 源端实际存在的会话 key（platform::id） */
    const seenKeys = new Set<string>()

    for (const plugin of plugins) {
      if (!plugin.isAvailable()) continue

      // 读取失败重试一次（L7：同步单次失败即跳过且无重试）
      let sessions: UnifiedSession[] | null = null
      let lastErr: unknown = null
      for (let attempt = 0; attempt < 2 && sessions === null; attempt++) {
        try {
          sessions = plugin.getSessions()
        } catch (err) {
          lastErr = err
        }
      }

      if (sessions === null) {
        console.error(`[Cache] Error syncing plugin ${plugin.manifest.id} (after retry):`, lastErr)
        logPluginEvent('error', plugin.manifest.id, '同步失败：读取会话列表异常', lastErr)
        errors++
        continue
      }

      succeededPlugins.add(plugin.manifest.id)
      totalSessions += sessions.length

      for (const session of sessions) {
        seenKeys.add(`${session.cli}::${session.id}`)
        const newHash = this.computeHash(session)
        const row = this.db!.prepare(
          'SELECT data_hash FROM sessions_cache WHERE id = ? AND platform = ?'
        ).get(session.id, session.cli) as { data_hash: string | null } | undefined

        if (row && row.data_hash === newHash) {
          continue
        }

        // 单会话容错：消息解析失败计入 errors，但不中断该平台其余会话同步
        let messages: SessionMessage[] = []
        try {
          messages = plugin.getMessages(session.id, session)
        } catch (err) {
          console.error(`[Cache] Error reading messages for ${plugin.manifest.id}/${session.id}:`, err)
          logPluginEvent('error', plugin.manifest.id, `读取消息失败：${session.id}`, err)
          errors++
        }

        const sessionTx = this.db!.transaction(() => {
          // 插入/更新 sessions_cache
          this.db!.prepare(`
            INSERT INTO sessions_cache
              (id, platform, category, title, cwd, model, cost, status, message_count,
               created_at, updated_at, raw_location, data_hash, extra)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              platform = excluded.platform,
              category = excluded.category,
              title = CASE WHEN excluded.title != '' THEN excluded.title ELSE sessions_cache.title END,
              cwd = excluded.cwd,
              model = excluded.model,
              cost = excluded.cost,
              status = excluded.status,
              message_count = excluded.message_count,
              updated_at = excluded.updated_at,
              raw_location = excluded.raw_location,
              data_hash = excluded.data_hash,
              extra = excluded.extra
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

          // 删除旧 FTS 索引
          this.db!.prepare(DELETE_FTS_SQL).run(session.id)

          this.writeMessages(session, messages)
        })

        sessionTx()

        // Auto-tag session
        try {
          const msgList = messages.map((m: SessionMessage) => ({ role: m.role, content: m.content }))
          tagService.autoTagSession(session.id, session.cli, session.title, msgList)
        } catch {
          // tagging is best-effort
        }

        syncedSessions++
      }
    }

    // H4：prune 源端已消失（被删除）的会话，避免“幽灵会话”残留
    try {
      this.pruneStaleSessions(succeededPlugins, seenKeys)
    } catch (err) {
      console.error('[Cache] Failed to prune stale sessions:', err)
    }

    // 更新同步时间
    this.db.prepare(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)'
    ).run('last_sync_at', new Date().toISOString())

    return { synced: syncedSessions, total: totalSessions, errors }
  }

  /**
   * 将会话消息与 FTS 索引写入缓存（保证消息 id 会话内唯一，超长内容分块索引）
   */
  private writeMessages(session: UnifiedSession, messages: SessionMessage[]): void {
    const insertMsg = this.db!.prepare(`
      INSERT OR REPLACE INTO messages_cache
        (id, session_id, platform, role, content, thought, tool_calls_json, timestamp, model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertFts = this.db!.prepare(INSERT_FTS_SQL)

    const tagsStr = Array.isArray(session.extra?.tags) ? (session.extra.tags as string[]).join(' ') : ''
    const segmentedTags = this.segmentText(tagsStr)
    const segmentedTitle = this.segmentText(session.title || '')
    const usedIds = new Set<string>()

    for (const [idx, msg] of messages.entries()) {
      const rawMsgId = uniqueMsgId(usedIds, msg.id || String(idx), idx)
      const msgId = `${session.cli}_${session.id}_${rawMsgId}`
      const contentStr = typeof msg.content === 'string' ? msg.content : (msg.content ? JSON.stringify(msg.content) : '')
      const thoughtStr = typeof msg.thought === 'string' ? msg.thought : (msg.thought ? JSON.stringify(msg.thought) : null)
      const toolCallsStr = msg.toolCalls ? JSON.stringify(msg.toolCalls) : '[]'

      insertMsg.run(
        msgId, session.id, session.cli,
        msg.role || 'user', contentStr,
        thoughtStr,
        toolCallsStr,
        typeof msg.timestamp === 'number' ? msg.timestamp : null,
        msg.model ? String(msg.model) : null
      )

      if ((msg.role === 'user' || msg.role === 'assistant') && (contentStr || msg.toolCalls?.length)) {
        const toolSummary = this.extractToolSummary(msg.toolCalls)
        const segmentedToolSummary = this.segmentText(toolSummary)

        // L5：超长消息分块建立 FTS 索引，避免 50000 字符截断导致后半内容不可搜索
        const chunks = contentStr.length <= FTS_CHUNK_SIZE
          ? [contentStr]
          : Array.from({ length: Math.ceil(contentStr.length / FTS_CHUNK_SIZE) }, (_, i) =>
              contentStr.slice(i * FTS_CHUNK_SIZE, (i + 1) * FTS_CHUNK_SIZE))

        for (const chunk of chunks) {
          insertFts.run(
            this.segmentText(chunk),
            segmentedTitle,
            segmentedToolSummary,
            session.cwd || '',
            segmentedTags,
            // TOMB-21：FTS 索引的 message_id 必须与 messages_cache.id 一致（复合 id），
            // 否则搜索结果无法定位锚点，且 LEFT JOIN messages_cache 恒为 NULL
            msgId,
            session.id,
            session.cli,
            msg.role
          )
        }
      }
    }
  }

  /**
   * H4：删除源端已不存在、但缓存中仍残留的会话（幽灵会话）。
   * 仅处理本次同步成功的插件；消息与 FTS 索引级联清理。
   */
  private pruneStaleSessions(succeededPlugins: Set<string>, seenKeys: Set<string>): void {
    if (!this.db || succeededPlugins.size === 0) return

    const placeholders = Array.from(succeededPlugins).map(() => '?').join(',')
    const rows = this.db.prepare(
      `SELECT id, platform FROM sessions_cache WHERE platform IN (${placeholders})`
    ).all(...succeededPlugins) as Array<{ id: string, platform: string }>

    const stale = rows.filter(r => !seenKeys.has(`${r.platform}::${r.id}`))
    if (stale.length === 0) return

    const delSession = this.db.prepare('DELETE FROM sessions_cache WHERE id = ? AND platform = ?')
    const delMessages = this.db.prepare('DELETE FROM messages_cache WHERE session_id = ? AND platform = ?')
    const delFts = this.db.prepare(DELETE_FTS_SQL)

    const tx = this.db.transaction(() => {
      for (const r of stale) {
        delFts.run(r.id)
        delMessages.run(r.id, r.platform)
        delSession.run(r.id, r.platform)
      }
    })
    tx()

    console.log(`[Cache] Pruned ${stale.length} stale session(s) removed at source`)
  }

  /**
   * 同步所有适配器会话（别名）
   */
  syncAll(): { synced: number, total: number, errors: number } {
    return this.sync()
  }

  /**
   * 从缓存中获取会话列表（仅返回当前已启用的插件会话）
   */
  getCachedSessions(platformFilter?: string, searchQuery?: string): UnifiedSession[] {
    this.init()
    if (!this.db) return []

    try {
      const activePlugins = pluginManager.getActivePlugins()
      const activePluginIds = activePlugins.map(p => p.manifest.id)
      if (activePluginIds.length === 0) return []

      let sql = 'SELECT * FROM sessions_cache'
      const params: unknown[] = []
      const conditions: string[] = []

      if (platformFilter && platformFilter !== 'all') {
        if (!activePluginIds.includes(platformFilter)) {
          return []
        }
        conditions.push('platform = ?')
        params.push(platformFilter)
      } else {
        const placeholders = activePluginIds.map(() => '?').join(',')
        conditions.push(`platform IN (${placeholders})`)
        params.push(...activePluginIds)
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

      const rows = this.db.prepare(sql).all(...params) as SessionCacheRow[]
      return rows.map(r => this.rowToSession(r)).filter(Boolean) as UnifiedSession[]
    } catch (err) {
      console.error('[Cache] Error reading cached sessions:', err)
      return []
    }
  }

  /**
   * 单会话按需增量同步到缓存
   */
  syncSingleSession(platform: PlatformType, id: string): {
    session: UnifiedSession | null
    messages: SessionMessage[]
  } {
    this.init()
    const detail = pluginManager.getMessages(platform, id)
    if (!detail.session || !this.db) {
      return detail
    }

    const { session, messages } = detail
    const newHash = this.computeHash(session)

    try {
      const syncTx = this.db.transaction(() => {
        this.db!.prepare(`
          INSERT INTO sessions_cache
            (id, platform, category, title, cwd, model, cost, status, message_count,
             created_at, updated_at, raw_location, data_hash, extra)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            platform = excluded.platform,
            category = excluded.category,
            title = CASE WHEN excluded.title != '' THEN excluded.title ELSE sessions_cache.title END,
            cwd = excluded.cwd,
            model = excluded.model,
            cost = excluded.cost,
            status = excluded.status,
            message_count = excluded.message_count,
            updated_at = excluded.updated_at,
            raw_location = excluded.raw_location,
            data_hash = excluded.data_hash,
            extra = excluded.extra
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

        this.db!.prepare(
          'DELETE FROM messages_cache WHERE session_id = ? AND platform = ?'
        ).run(session.id, session.cli)

        this.db!.prepare(DELETE_FTS_SQL).run(session.id)

        this.writeMessages(session, messages)
      })
      syncTx()
    } catch (err) {
      console.error('[Cache] Error in syncSingleSession:', err)
    }

    return this.getCachedSessionDetail(platform, id)
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
      ).get(id, platform) as SessionCacheRow | undefined

      if (!srow) return { session: null, messages: [] }

      const mrows = this.db.prepare(
        'SELECT * FROM messages_cache WHERE session_id = ? AND platform = ? ORDER BY timestamp ASC'
      ).all(id, platform) as MessageCacheRow[]

      return {
        session: this.rowToSession(srow),
        messages: mrows.map(r => this.rowToMessage(r)).filter(Boolean) as SessionMessage[]
      }
    } catch (err) {
      console.error('[Cache] Error reading cached session detail:', err)
      return { session: null, messages: [] }
    }
  }

  /**
   * FTS5 全文搜索（支持中英文分词与多维联合过滤）
   */
  search(query: string, options: SearchOptions = {}): SearchResponse {
    this.init()
    const limit = Math.min(100, Math.max(1, options.limit ?? 20))
    const offset = Math.max(0, options.offset ?? 0)
    const groupBy = options.groupBy || 'session'
    const page = Math.floor(offset / limit) + 1

    if (!this.db || !query.trim()) {
      return { results: [], total: 0, query, page, pageSize: limit }
    }

    const empty: SearchResponse = { results: [], total: 0, query, page, pageSize: limit }

    try {
      const ftsQuery = this.escapeFtsQuery(query)
      if (!ftsQuery) return empty

      // 动态拼接过滤条件
      const conditions: string[] = ['fts_messages MATCH ?']
      const params: unknown[] = [ftsQuery]

      if (options.platform && options.platform !== 'all') {
        conditions.push('f.platform = ?')
        params.push(options.platform)
      }

      if (options.role && options.role !== 'all') {
        conditions.push('f.role = ?')
        params.push(options.role)
      }

      if (options.cwd) {
        conditions.push('s.cwd LIKE ?')
        params.push(`%${options.cwd}%`)
      }

      if (options.tag) {
        conditions.push('s.tags LIKE ?')
        params.push(`%${options.tag}%`)
      }

      const whereClause = conditions.join(' AND ')

      // 1. 统计去重后的匹配消息总数（同一消息的超长分块只计一次）及各平台分布
      const countSql = `
        SELECT f.platform, COUNT(DISTINCT f.message_id) as c
        FROM fts_messages f
        LEFT JOIN sessions_cache s ON s.id = f.session_id AND s.platform = f.platform
        WHERE ${whereClause}
        GROUP BY f.platform
      `
      const platformCounts = this.db.prepare(countSql).all(...params) as { platform: string, c: number }[]
      const platformMap: Record<string, number> = {}
      let totalMessages = 0
      for (const p of platformCounts) {
        platformMap[p.platform] = p.c
        totalMessages += p.c
      }

      if (totalMessages === 0) return empty

      if (groupBy === 'session') {
        // 2a. 统计匹配的会话总数（修正：此前 total 为消息数，分页基于消息行导致分组错乱）
        const sessionCountSql = `
          SELECT COUNT(*) AS c FROM (
            SELECT f.session_id, f.platform
            FROM fts_messages f
            LEFT JOIN sessions_cache s ON s.id = f.session_id AND s.platform = f.platform
            WHERE ${whereClause}
            GROUP BY f.session_id, f.platform
          )
        `
        const totalSessionsCount = (this.db.prepare(sessionCountSql).get(...params) as { c: number }).c
        if (totalSessionsCount === 0) return empty

        // 2b. 会话分组的分页取页：内层 GROUP BY + MIN(rank) 取每组代表行（SQLite 特性：
        //     唯一 min/max 聚合时，裸列取自极值所在行），LIMIT/OFFSET 作用于会话组。
        //     注意：SQLite 不允许 snippet() 与窗口/聚合函数同 SELECT（TOMB-21），
        //     因此分组过滤放在 rowid 子查询中，snippet 在外层查询生成
        const groupPageSql = `
          SELECT
            f.rowid,
            f.message_id,
            f.session_id,
            f.platform,
            f.role,
            s.title,
            s.cwd,
            s.tags,
            s.updated_at,
            f.tool_summary,
            snippet(fts_messages, 0, '<mark>', '</mark>', '...', 40) AS snippet,
            f.rank
          FROM fts_messages f
          LEFT JOIN sessions_cache s ON s.id = f.session_id AND s.platform = f.platform
          WHERE ${whereClause}
            AND f.rowid IN (
              SELECT rowid FROM (
                SELECT f.rowid AS rowid, MIN(f.rank) AS best_rank
                FROM fts_messages f
                LEFT JOIN sessions_cache s ON s.id = f.session_id AND s.platform = f.platform
                WHERE ${whereClause}
                GROUP BY f.session_id, f.platform
                ORDER BY best_rank
                LIMIT ? OFFSET ?
              )
            )
          ORDER BY f.rank
        `
        const pageRows = this.db.prepare(groupPageSql).all(...params, ...params, limit, offset) as Array<{
          rowid: number
          message_id: string
          session_id: string
          platform: string
          role: string
          title: string
          cwd: string
          tags: string
          updated_at: number
          tool_summary?: string
          snippet: string
          rank: number
        }>

        // 2c. 本页会话的匹配消息数与 top-5 片段
        const keyConditions = pageRows.map(() => '(f.session_id = ? AND f.platform = ?)').join(' OR ')
        const keyParams = pageRows.flatMap(r => [r.session_id, r.platform])

        const countMap = new Map<string, number>()
        const snippetMap = new Map<string, Array<{ message_id: string, role: string, snippet: string }>>()

        if (pageRows.length > 0) {
          const matchedCountSql = `
            SELECT f.session_id, f.platform, COUNT(DISTINCT f.message_id) AS c
            FROM fts_messages f
            LEFT JOIN sessions_cache s ON s.id = f.session_id AND s.platform = f.platform
            WHERE ${whereClause} AND (${keyConditions})
            GROUP BY f.session_id, f.platform
          `
          const countRows = this.db.prepare(matchedCountSql).all(...params, ...keyParams) as Array<{ session_id: string, platform: string, c: number }>
          for (const r of countRows) {
            countMap.set(`${r.platform}::${r.session_id}`, r.c)
          }

          // 与 2b 相同：窗口函数在 rowid 子查询中，snippet 在外层生成（SQLite 限制）
          const snippetSql = `
            SELECT
              f.session_id,
              f.platform,
              f.message_id,
              f.role,
              substr(m.content, 1, 160) AS raw_content,
              snippet(fts_messages, 0, '<mark>', '</mark>', '...', 40) AS snippet
            FROM fts_messages f
            LEFT JOIN sessions_cache s ON s.id = f.session_id AND s.platform = f.platform
            LEFT JOIN messages_cache m ON m.id = f.message_id
            WHERE ${whereClause} AND (${keyConditions})
              AND f.rowid IN (
                SELECT rowid FROM (
                  SELECT
                    f.rowid AS rowid,
                    ROW_NUMBER() OVER (PARTITION BY f.session_id, f.platform ORDER BY f.rank) AS rn
                  FROM fts_messages f
                  LEFT JOIN sessions_cache s ON s.id = f.session_id AND s.platform = f.platform
                  WHERE ${whereClause} AND (${keyConditions})
                ) WHERE rn <= 5
              )
            ORDER BY f.rank
          `
          const snippetRows = this.db.prepare(snippetSql).all(...params, ...keyParams, ...params, ...keyParams) as Array<{
            session_id: string
            platform: string
            message_id: string
            role: string
            raw_content?: string
            snippet: string
          }>
          for (const r of snippetRows) {
            const key = `${r.platform}::${r.session_id}`
            if (!snippetMap.has(key)) snippetMap.set(key, [])
            snippetMap.get(key)!.push({
              message_id: r.message_id,
              role: r.role,
              snippet: this.resolveSnippet(r.snippet, r.raw_content)
            })
          }
        }

        const parseTags = (raw: string): string[] => {
          try {
            return raw ? JSON.parse(raw) as string[] : []
          } catch {
            return []
          }
        }

        const groupedSessions: SessionGroupedSearchResult[] = pageRows.map((r) => {
          const key = `${r.platform}::${r.session_id}`
          return {
            session_id: r.session_id,
            platform: r.platform,
            title: r.title || '无标题会话',
            cwd: r.cwd || '',
            tags: parseTags(r.tags),
            updated_at: r.updated_at || Date.now(),
            matchedCount: countMap.get(key) || 1,
            bestRank: r.rank,
            snippets: snippetMap.get(key) || []
          }
        })

        const results: SearchResultItem[] = pageRows.map(r => ({
          rowid: r.rowid,
          message_id: r.message_id || `msg_${r.rowid}`,
          session_id: r.session_id,
          platform: r.platform,
          role: r.role,
          title: r.title || '无标题会话',
          cwd: r.cwd || '',
          tags: parseTags(r.tags),
          updated_at: r.updated_at || Date.now(),
          snippet: this.cleanSnippetSpaces(r.snippet),
          tool_summary: r.tool_summary || undefined,
          rank: r.rank
        }))

        return {
          results,
          groupedSessions,
          total: totalSessionsCount,
          query,
          page,
          pageSize: limit,
          platforms: platformMap
        }
      }

      // 2. 消息平铺模式：查询明细并按 message_id 去重（超长消息的分块索引会命中多次）
      const searchSql = `
        SELECT
          f.rowid,
          f.message_id,
          f.session_id,
          f.platform,
          f.role,
          s.title,
          s.cwd,
          s.tags,
          s.updated_at,
          substr(m.content, 1, 160) as raw_content,
          f.tool_summary,
          snippet(fts_messages, 0, '<mark>', '</mark>', '...', 40) AS snippet,
          f.rank
        FROM fts_messages f
        LEFT JOIN sessions_cache s ON s.id = f.session_id AND s.platform = f.platform
        LEFT JOIN messages_cache m ON m.id = f.message_id
        WHERE ${whereClause}
        ORDER BY f.rank
        LIMIT ? OFFSET ?
      `

      const rows = this.db.prepare(searchSql).all(...params, limit * 5, 0) as Array<{
        rowid: number
        message_id: string
        session_id: string
        platform: string
        role: string
        title: string
        cwd: string
        tags: string
        updated_at: number
        raw_content?: string
        tool_summary?: string
        snippet: string
        rank: number
      }>

      const seenMessageIds = new Set<string>()
      const results: SearchResultItem[] = []
      for (const r of rows) {
        const key = `${r.platform}::${r.message_id}`
        if (seenMessageIds.has(key)) continue
        seenMessageIds.add(key)

        let tags: string[] = []
        try {
          if (r.tags) tags = JSON.parse(r.tags) as string[]
        } catch {
          tags = []
        }

        results.push({
          rowid: r.rowid,
          message_id: r.message_id || `msg_${r.rowid}`,
          session_id: r.session_id,
          platform: r.platform,
          role: r.role,
          title: r.title || '无标题会话',
          cwd: r.cwd || '',
          tags,
          updated_at: r.updated_at || Date.now(),
          snippet: this.resolveSnippet(r.snippet, r.raw_content),
          tool_summary: r.tool_summary || undefined,
          rank: r.rank
        })

        if (results.length >= limit + offset) break
      }

      return {
        results: results.slice(offset, offset + limit),
        total: totalMessages,
        query,
        page,
        pageSize: limit,
        platforms: platformMap
      }
    } catch (err) {
      console.error('[Cache] FTS5 search error:', err)
      return empty
    }
  }

  /**
   * 将用户输入转义为 FTS5 分词匹配语法
   */
  private escapeFtsQuery(query: string): string {
    const raw = query.trim()
    if (!raw) return ''

    try {
      const segments = Array.from(this.segmenter.segment(raw))
      const tokens = segments
        .map(s => s.segment.trim())
        .filter(s => s.length > 0 && !/^[\s,.:;!?'"()[\]{}]+$/.test(s))

      if (tokens.length === 0) return ''

      return tokens.map((t) => {
        // 纯英文/数字/下划线/中划线 -> 前缀模糊匹配
        if (/^[a-zA-Z0-9_\-.]+$/.test(t)) {
          return `${t}*`
        }
        // 中文字符或混合字符 -> 短语精确/词匹配
        return `"${t.replace(/"/g, '""')}"`
      }).join(' ')
    } catch {
      return `"${raw.replace(/"/g, '""')}"`
    }
  }

  /**
   * 清理分词高亮片段中由于分词产生的多余中文空格
   */
  /**
   * 生成展示用 snippet（TOMB-21 / P1）：
   * FTS 命中 content 列时 snippet 含 <mark> 高亮，直接使用；
   * 命中 title/cwd/tags/tool_summary 列时 snippet 无高亮（展示的是无关正文），
   * 此时退回消息正文开头作为预览，避免误导。
   */
  private resolveSnippet(ftsSnippet: string, rawContent?: string | null): string {
    const cleaned = this.cleanSnippetSpaces(ftsSnippet || '')
    if (cleaned.includes('<mark>')) return cleaned
    const preview = (rawContent || '').replace(/\s+/g, ' ').trim()
    if (preview) return preview.length > 80 ? preview.slice(0, 80) + '...' : preview
    return cleaned
  }

  private cleanSnippetSpaces(snippet: string): string {
    if (!snippet) return ''
    return snippet
      .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2')
      .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2')
  }

  private rowToSession(row: SessionCacheRow): UnifiedSession | null {
    if (!row) return null
    const extra = (row.extra ? this.safeJsonParse<Record<string, unknown>>(row.extra) : {}) as Record<string, unknown>
    if (row.tags) {
      try {
        extra.tags = JSON.parse(row.tags) as string[]
      } catch {
        extra.tags = []
      }
    }
    return {
      id: row.id,
      cli: row.platform,
      category: (row.category || 'cli') as UnifiedSession['category'],
      title: row.title || '',
      cwd: row.cwd || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count || 0,
      model: row.model || undefined,
      cost: row.cost || undefined,
      status: row.status || undefined,
      rawLocation: row.raw_location || '',
      extra
    }
  }

  private rowToMessage(row: MessageCacheRow): SessionMessage | null {
    if (!row) return null
    return {
      id: row.id,
      role: row.role as SessionMessage['role'],
      content: row.content || '',
      thought: row.thought || undefined,
      toolCalls: row.tool_calls_json ? this.safeJsonParse<SessionToolCall[]>(row.tool_calls_json) as SessionToolCall[] : undefined,
      timestamp: row.timestamp || undefined,
      model: row.model || undefined
    }
  }

  private safeJsonParse<T = unknown>(str: string): T | string {
    try {
      return JSON.parse(str) as T
    } catch {
      return str
    }
  }

  /**
   * 更新缓存中指定会话的标题
   */
  updateSessionTitle(sessionId: string, platform: string, newTitle: string): boolean {
    this.init()
    if (!this.db) return false
    try {
      const tx = this.db.transaction(() => {
        this.db!.prepare(
          'UPDATE sessions_cache SET title = ?, updated_at = ? WHERE id = ? AND platform = ?'
        ).run(newTitle, Date.now(), sessionId, platform)

        try {
          const segmented = this.segmentText(newTitle)
          this.db!.prepare(
            'UPDATE fts_messages SET title = ? WHERE session_id = ? AND platform = ?'
          ).run(segmented, sessionId, platform)
        } catch {
          // fts entry may be missing
        }
      })
      tx()
      return true
    } catch (err) {
      console.error('[Cache] Error updating session title:', err)
      return false
    }
  }

  /**
   * 从缓存中获取各平台的会话统计数量（仅统计已启用的插件）
   */
  getCachedStats(): { total: number, counts: Record<string, number> } {
    this.init()
    const counts: Record<string, number> = {}
    const activePlugins = pluginManager.getActivePlugins()
    for (const plugin of activePlugins) {
      counts[plugin.manifest.id] = 0
    }

    if (!this.db || activePlugins.length === 0) {
      return { total: 0, counts }
    }

    try {
      const placeholders = activePlugins.map(() => '?').join(',')
      const ids = activePlugins.map(p => p.manifest.id)
      const rows = this.db.prepare(
        `SELECT platform, COUNT(*) as count FROM sessions_cache WHERE platform IN (${placeholders}) GROUP BY platform`
      ).all(...ids) as { platform: string, count: number }[]

      let total = 0
      for (const row of rows) {
        if (row.platform in counts) {
          counts[row.platform] = row.count
          total += row.count
        }
      }

      return { total, counts }
    } catch (err) {
      console.error('[Cache] Error getting cached platform stats:', err)
      return { total: 0, counts }
    }
  }

  /**
   * 从缓存中删除会话及相关消息和 FTS 索引
   */
  deleteFromCache(sessionId: string, platform: string): boolean {
    this.init()
    if (!this.db) return false
    try {
      const tx = this.db.transaction(() => {
        this.db!.prepare('DELETE FROM fts_messages WHERE session_id = ?').run(sessionId)
        this.db!.prepare('DELETE FROM messages_cache WHERE session_id = ? AND platform = ?').run(sessionId, platform)
        this.db!.prepare('DELETE FROM sessions_cache WHERE id = ? AND platform = ?').run(sessionId, platform)
      })
      tx()
      return true
    } catch (err) {
      console.error('[Cache] Error deleting from cache:', err)
      return false
    }
  }
}

// 导出单例
export const cacheService = new CacheService()
