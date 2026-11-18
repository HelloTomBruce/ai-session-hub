import { cacheService } from './cache-service'
import { memoryService } from './memory-service'
import { extractMemoryFromSession, buildMessagesContent } from './memory-extractor'
import { pluginManager } from './plugin-manager'
import { getLLMProviderSettings } from './llm-provider-config'
import type { UnifiedSession, SessionMessage, PlatformType } from './types'
import type { MemoryGraphItem, ProjectEntity } from './memory-types'
import type Database from 'better-sqlite3'

export interface HarvestRecord {
  sessionId: string
  platform: string
  status: 'harvested' | 'skipped' | 'failed'
  reason?: string
  memoryId?: string
  memoryTitle?: string
  confidence?: number
  createdAt: number
  updatedAt: number
}

export interface BatchHarvestOptions {
  limit?: number
  platform?: string
  force?: boolean
}

export interface BatchHarvestResult {
  totalScanned: number
  harvested: number
  skipped: number
  failed: number
  records: Array<{
    sessionId: string
    platform: string
    status: 'harvested' | 'skipped' | 'failed'
    title?: string
    memoryId?: string
    reason?: string
  }>
}

class AutoHarvestService {
  private schemaReady = false

  private ensureSchema(db: Database.Database) {
    if (this.schemaReady) return
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_harvests (
        session_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        memory_id TEXT,
        memory_title TEXT,
        confidence INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, platform)
      );
      CREATE INDEX IF NOT EXISTS idx_session_harvests_status ON session_harvests(status);
    `)
    this.schemaReady = true
  }

  /**
   * 检查会话是否值得交给 LLM 提炼（低价值预过滤，节约 Token 与时间）
   */
  isCandidateForHarvest(session: UnifiedSession, messages: SessionMessage[]): { pass: boolean, reason?: string } {
    if (!messages || messages.length < 3) {
      return { pass: false, reason: '会话消息过短 (少于 3 条)' }
    }

    let hasSubstantialAction = false
    let hasTools = false
    let codeBlockCount = 0

    for (const msg of messages) {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        hasTools = true
        hasSubstantialAction = true
        break
      }
      if (msg.content && msg.content.includes('```')) {
        codeBlockCount++
        if (codeBlockCount >= 2) {
          hasSubstantialAction = true
          break
        }
      }
    }

    if (!hasSubstantialAction) {
      return { pass: false, reason: '未检测到工具调用或实质代码改动，属低密度对话' }
    }

    return { pass: true }
  }

  /**
   * 收割单条会话
   */
  async harvestSession(platform: string, sessionId: string, force = false): Promise<HarvestRecord> {
    const db = cacheService.getDb()
    if (!db) {
      throw new Error('缓存数据库未就绪')
    }
    this.ensureSchema(db)

    const now = Date.now()
    const existing = db.prepare(
      'SELECT * FROM session_harvests WHERE session_id = ? AND platform = ?'
    ).get(sessionId, platform) as {
      session_id: string
      platform: string
      status: string
      reason: string | null
      memory_id: string | null
      memory_title: string | null
      confidence: number | null
      created_at: number
      updated_at: number
    } | undefined

    if (existing && !force && existing.status === 'harvested') {
      return {
        sessionId: existing.session_id,
        platform: existing.platform,
        status: 'harvested',
        reason: '已经收割入库',
        memoryId: existing.memory_id || undefined,
        memoryTitle: existing.memory_title || undefined,
        confidence: existing.confidence || undefined,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at
      }
    }

    // 获取会话详情与消息
    let detail = cacheService.getCachedSessionDetail(platform as PlatformType, sessionId)
    if (!detail || !detail.session || !detail.messages) {
      // 尝试从 pluginManager 加载
      const pmDetail = pluginManager.getMessages(platform as PlatformType, sessionId)
      if (pmDetail && pmDetail.session && pmDetail.messages) {
        detail = { session: pmDetail.session, messages: pmDetail.messages }
      }
    }

    if (!detail || !detail.session) {
      const record: HarvestRecord = {
        sessionId,
        platform,
        status: 'failed',
        reason: '无法读取会话详情或消息',
        createdAt: existing?.created_at || now,
        updatedAt: now
      }
      this.upsertRecord(db, record)
      return record
    }

    const { session, messages } = detail

    // 预筛选规则
    const candidateCheck = this.isCandidateForHarvest(session, messages)
    if (!candidateCheck.pass) {
      const record: HarvestRecord = {
        sessionId,
        platform,
        status: 'skipped',
        reason: candidateCheck.reason,
        createdAt: existing?.created_at || now,
        updatedAt: now
      }
      this.upsertRecord(db, record)
      return record
    }

    const messagesContent = buildMessagesContent(messages)
    if (messagesContent.trim().length < 80) {
      const record: HarvestRecord = {
        sessionId,
        platform,
        status: 'skipped',
        reason: '会话正文有效字符过少 (< 80 字)，跳过提炼',
        createdAt: existing?.created_at || now,
        updatedAt: now
      }
      this.upsertRecord(db, record)
      return record
    }

    // 检查 LLM 配置
    const provider = getLLMProviderSettings()
    if (!provider.enabled || !provider.apiKey) {
      const record: HarvestRecord = {
        sessionId,
        platform,
        status: 'failed',
        reason: 'LLM Provider 未配置有效 API Key',
        createdAt: existing?.created_at || now,
        updatedAt: now
      }
      this.upsertRecord(db, record)
      return record
    }

    // 调用提取器
    try {
      const messagesContent = buildMessagesContent(messages)
      const extracted = await extractMemoryFromSession({
        sessionTitle: session.title,
        platform: session.cli,
        cwd: session.cwd,
        messagesContent
      })

      if (!extracted.title || !extracted.content) {
        const record: HarvestRecord = {
          sessionId,
          platform,
          status: 'skipped',
          reason: '模型判断无高复用价值技术资产，未提炼正文',
          createdAt: existing?.created_at || now,
          updatedAt: now
        }
        this.upsertRecord(db, record)
        return record
      }

      // 置信度过低时跳过（避免污染图谱）
      const confidence = typeof extracted.confidence === 'number' ? extracted.confidence : 75
      if (confidence < 60) {
        const record: HarvestRecord = {
          sessionId,
          platform,
          status: 'skipped',
          confidence,
          reason: `置信度过低 (${confidence} < 60)，跳过入库`,
          createdAt: existing?.created_at || now,
          updatedAt: now
        }
        this.upsertRecord(db, record)
        return record
      }

      // 组装并写入记忆图谱（通过去重管线）
      const projects: ProjectEntity[] = extracted.projects?.length
        ? extracted.projects
        : (session.cwd ? [{ name: session.cwd.split('/').pop() || 'project', cwd: session.cwd }] : [])

      const memoryPayload: Partial<MemoryGraphItem> & { title: string, content: string } = {
        ...extracted,
        title: extracted.title,
        content: extracted.content,
        type: extracted.type || 'Gotcha',
        confidence,
        projects,
        sourceMeta: {
          platform: session.cli,
          sessionId: session.id,
          sessionTitle: session.title,
          extractedAt: now,
          category: extracted.type,
          evaluatorVersion: 2
        }
      }

      const saveResult = await memoryService.saveMemoryWithDedup(
        memoryPayload,
        { sessionId: session.id, platform: session.cli }
      )

      const savedItem = saveResult.item
      const record: HarvestRecord = {
        sessionId,
        platform,
        status: 'harvested',
        memoryId: savedItem.id,
        memoryTitle: savedItem.title,
        confidence,
        reason: `成功入库 (${saveResult.dedup})`,
        createdAt: existing?.created_at || now,
        updatedAt: now
      }
      this.upsertRecord(db, record)
      return record
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const record: HarvestRecord = {
        sessionId,
        platform,
        status: 'failed',
        reason: `提取异常: ${errMsg}`,
        createdAt: existing?.created_at || now,
        updatedAt: now
      }
      this.upsertRecord(db, record)
      return record
    }
  }

  /**
   * 批量收割
   */
  async batchHarvest(options: BatchHarvestOptions = {}): Promise<BatchHarvestResult> {
    const db = cacheService.getDb()
    if (!db) throw new Error('缓存数据库未就绪')
    this.ensureSchema(db)

    const limit = Math.min(options.limit || 5, 20)
    const platform = options.platform

    // 筛选尚未成功收割的会话，按最近更新优先
    let sql = `
      SELECT s.id, s.platform, s.title, s.cwd, s.message_count, s.updated_at
      FROM sessions_cache s
      LEFT JOIN session_harvests h ON s.id = h.session_id AND s.platform = h.platform
      WHERE (h.status IS NULL ${options.force ? "OR h.status IN ('failed', 'skipped')" : ''})
    `
    const params: unknown[] = []
    if (platform) {
      sql += ' AND s.platform = ?'
      params.push(platform)
    }
    // 过滤掉消息极少的
    sql += ' AND s.message_count >= 3'
    sql += ' ORDER BY s.updated_at DESC LIMIT ?'
    params.push(limit)

    const candidates = db.prepare(sql).all(...params) as Array<{
      id: string
      platform: string
      title: string
      cwd: string
      message_count: number
      updated_at: number
    }>

    const result: BatchHarvestResult = {
      totalScanned: candidates.length,
      harvested: 0,
      skipped: 0,
      failed: 0,
      records: []
    }

    for (const c of candidates) {
      try {
        const record = await this.harvestSession(c.platform, c.id, options.force)
        if (record.status === 'harvested') result.harvested++
        else if (record.status === 'skipped') result.skipped++
        else result.failed++

        result.records.push({
          sessionId: c.id,
          platform: c.platform,
          status: record.status,
          title: record.memoryTitle || c.title,
          memoryId: record.memoryId,
          reason: record.reason
        })
      } catch (e) {
        result.failed++
        result.records.push({
          sessionId: c.id,
          platform: c.platform,
          status: 'failed',
          title: c.title,
          reason: e instanceof Error ? e.message : String(e)
        })
      }
    }

    return result
  }

  /**
   * 获取收割统计与概览
   */
  getHarvestStats(): {
    totalSessions: number
    harvestedCount: number
    skippedCount: number
    failedCount: number
    pendingCount: number
    recentHarvests: Array<{
      sessionId: string
      platform: string
      memoryId: string | null
      memoryTitle: string | null
      confidence: number | null
      updatedAt: number
    }>
  } {
    const db = cacheService.getDb()
    if (!db) {
      return {
        totalSessions: 0,
        harvestedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        pendingCount: 0,
        recentHarvests: []
      }
    }
    this.ensureSchema(db)

    const total = (db.prepare('SELECT COUNT(*) as c FROM sessions_cache').get() as { c: number }).c
    const harvested = (db.prepare("SELECT COUNT(*) as c FROM session_harvests WHERE status = 'harvested'").get() as { c: number }).c
    const skipped = (db.prepare("SELECT COUNT(*) as c FROM session_harvests WHERE status = 'skipped'").get() as { c: number }).c
    const failed = (db.prepare("SELECT COUNT(*) as c FROM session_harvests WHERE status = 'failed'").get() as { c: number }).c
    const pending = Math.max(0, total - (harvested + skipped + failed))

    const recent = db.prepare(`
      SELECT session_id, platform, memory_id, memory_title, confidence, updated_at
      FROM session_harvests
      WHERE status = 'harvested'
      ORDER BY updated_at DESC
      LIMIT 10
    `).all() as Array<{
      session_id: string
      platform: string
      memory_id: string | null
      memory_title: string | null
      confidence: number | null
      updated_at: number
    }>

    return {
      totalSessions: total,
      harvestedCount: harvested,
      skippedCount: skipped,
      failedCount: failed,
      pendingCount: pending,
      recentHarvests: recent.map(r => ({
        sessionId: r.session_id,
        platform: r.platform,
        memoryId: r.memory_id,
        memoryTitle: r.memory_title,
        confidence: r.confidence,
        updatedAt: r.updated_at
      }))
    }
  }

  private upsertRecord(db: Database.Database, r: HarvestRecord) {
    db.prepare(`
      INSERT INTO session_harvests
        (session_id, platform, status, reason, memory_id, memory_title, confidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, platform) DO UPDATE SET
        status = excluded.status,
        reason = excluded.reason,
        memory_id = excluded.memory_id,
        memory_title = excluded.memory_title,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `).run(
      r.sessionId,
      r.platform,
      r.status,
      r.reason || null,
      r.memoryId || null,
      r.memoryTitle || null,
      r.confidence ?? null,
      r.createdAt,
      r.updatedAt
    )
  }
}

export const autoHarvestService = new AutoHarvestService()
