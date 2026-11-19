import fs from 'node:fs'
import path from 'node:path'
import { cacheService } from './cache-service'
import { logger } from './logger'
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
   * 检查会话是否值得交给 LLM 提炼（摩擦与避坑事件驱动过滤，杜绝日常琐碎业务增改污染知识库）
   */
  isCandidateForHarvest(session: UnifiedSession, messages: SessionMessage[]): { pass: boolean, reason?: string } {
    if (!messages || messages.length < 3) {
      return { pass: false, reason: '会话消息过短 (少于 3 条)' }
    }

    const title = (session.title || '').toLowerCase()

    // 1. 标题高价值技术关键词嗅探
    const highValueTitlePattern = /(排查|踩坑|报错|异常|修复|解决|重构|配置|升级|架构|工作流|集成|接入|规范|gotcha|bug|fix|error|issue)/i
    const isHighValueTitle = highValueTitlePattern.test(title)

    // 2. 检查是否有核心基建/配置文件改动
    const configFilePattern = /(package\.json|tsconfig.*\.json|nuxt\.config|vite\.config|webpack\.config|dockerfile|docker-compose|\.env|cargo\.toml|go\.mod|makefile|\.config\.(ts|js|mjs))/i
    let touchesConfigFile = false

    // 3. 检查是否有报错排查动作（Error-Fix Loop）
    const errorPattern = /(error|failed|exception|exit code [1-9]|typeerror|referenceerror|syntaxerror|enoent|eacces|找不到模块|编译失败|运行报错)/i
    let hasErrorSignal = false
    let hasToolAction = false

    for (const msg of messages) {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        hasToolAction = true
        for (const tc of msg.toolCalls) {
          const argsStr = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || tc.args || tc.input || '')
          if (configFilePattern.test(argsStr)) {
            touchesConfigFile = true
          }
        }
      }

      const text = `${msg.content || ''} ${msg.thought || ''}`
      if (errorPattern.test(text)) {
        hasErrorSignal = true
      }
    }

    if (!hasToolAction) {
      return { pass: false, reason: '未检测到实质工具执行或代码改动，属纯对话' }
    }

    // 核心准入条件：满足 (报错排错闭环) OR (修改核心基建配置) OR (高价值技术排障标题)
    if (!hasErrorSignal && !touchesConfigFile && !isHighValueTitle) {
      return { pass: false, reason: '未检测到排错踩坑或关键基建配置改动，属日常业务增改，无需沉淀' }
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

      // 双写机制：自动将高价值经验追加到当前项目的 .agents/gotchas.md，开发者 git diff 立即可见
      this.dualWriteToLocalProject(session.cwd, savedItem)

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
      WHERE (h.status IS NULL ${options.force ? `OR h.status IN ('failed', 'skipped')` : ''})
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
    const harvested = (db.prepare(`SELECT COUNT(*) as c FROM session_harvests WHERE status = 'harvested'`).get() as { c: number }).c
    const skipped = (db.prepare(`SELECT COUNT(*) as c FROM session_harvests WHERE status = 'skipped'`).get() as { c: number }).c
    const failed = (db.prepare(`SELECT COUNT(*) as c FROM session_harvests WHERE status = 'failed'`).get() as { c: number }).c
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

  /**
   * 双写机制：将提炼出的高价值经验追加到所属项目的 .agents/gotchas.md，开发者 git diff 立即可见
   */
  private dualWriteToLocalProject(cwd: string | undefined, item: MemoryGraphItem) {
    if (!cwd || typeof cwd !== 'string') return
    try {
      if (!fs.existsSync(cwd)) return

      const agentsDir = path.join(cwd, '.agents')
      if (!fs.existsSync(agentsDir)) {
        fs.mkdirSync(agentsDir, { recursive: true })
      }

      const gotchaFile = path.join(agentsDir, 'gotchas.md')
      const dateStr = new Date().toISOString().slice(0, 10)
      const existing = fs.existsSync(gotchaFile) ? fs.readFileSync(gotchaFile, 'utf-8') : '# 项目避坑与关键经验指南 (AI Session Hub 自动沉淀)\n'

      // 防止同一标题重复追加
      if (existing.includes(item.title)) return

      const lines: string[] = [
        `\n### 💡 [${dateStr}] ${item.title}`,
        `- **分类**: ${item.type || 'Gotcha'}`,
        `- **摘要**: ${item.summary || item.title}`
      ]

      if (item.problems && item.problems.length > 0) {
        lines.push(`- **报错现象**: ${item.problems.map(p => p.symptom || p.title).join('; ')}`)
      }

      if (item.snippets && item.snippets.length > 0 && item.snippets[0]) {
        const s = item.snippets[0]
        lines.push(`- **关键解法/配置**:`)
        lines.push(`\`\`\`${s.language || 'ts'}\n${(s.code || '').trim()}\n\`\`\``)
      }

      fs.writeFileSync(gotchaFile, existing.trimEnd() + '\n' + lines.join('\n') + '\n', 'utf-8')
    } catch (err) {
      // 本地写盘失败不阻断主流程
      logger.warn('[AutoHarvest] Dual-write to local .agents/gotchas.md skipped:', err)
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
