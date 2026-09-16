import { cacheService } from './cache-service'
import type { PlatformType, UnifiedSession, SessionMessage } from './types'
import type { QuantitativeEvaluationReport, ValueCategory, GradeLevel } from './evaluator-engine'

export interface KnowledgeItem {
  id: string
  sessionId?: string
  platform: PlatformType | string
  type: ValueCategory
  title: string
  context: string
  decision: string
  consequences: string
  consequence?: string
  tags: string[]
  score: number
  grade: GradeLevel
  sourceCwd?: string
  rawMarkdown?: string
  createdAt: number
  updatedAt: number
}

export interface ListKnowledgeOptions {
  type?: string
  tag?: string
  platform?: string
  search?: string
  limit?: number
  offset?: number
}

interface KnowledgeRow {
  id: string
  session_id?: string
  platform: string
  type: string
  title: string
  context?: string
  decision?: string
  consequence?: string
  tags?: string
  score?: number
  grade?: string
  source_cwd?: string
  raw_markdown?: string
  created_at: number
  updated_at: number
}

interface EvaluationRow {
  session_id: string
  overall_score: number
  grade: string
  category: string
  is_worth_saving: number
  sub_scores_json?: string
  signals_json?: string
  summary_reason?: string
  evaluated_at: number
}

class KnowledgeService {
  /**
   * Save or update a knowledge item in the vault
   */
  saveItem(item: Partial<KnowledgeItem> & { title: string, type: ValueCategory, platform: string }): KnowledgeItem {
    cacheService.init()
    const db = cacheService.getDb()
    if (!db) throw new Error('Database not initialized')

    const now = Date.now()
    const id = item.id || `kn_${item.type.toLowerCase()}_${now}_${Math.random().toString(36).slice(2, 7)}`
    const tagsJson = JSON.stringify(item.tags || [])

    const consequenceVal = item.consequences || item.consequence || ''
    const record: KnowledgeItem = {
      id,
      sessionId: item.sessionId || '',
      platform: item.platform,
      type: item.type,
      title: item.title,
      context: item.context || '',
      decision: item.decision || '',
      consequences: consequenceVal,
      consequence: consequenceVal,
      tags: item.tags || [],
      score: item.score || 80,
      grade: item.grade || 'A',
      sourceCwd: item.sourceCwd || '',
      rawMarkdown: item.rawMarkdown || '',
      createdAt: item.createdAt || now,
      updatedAt: now
    }

    db.prepare(`
      INSERT OR REPLACE INTO knowledge_vault
        (id, session_id, platform, type, title, context, decision, consequence,
         tags, score, grade, source_cwd, raw_markdown, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.sessionId,
      record.platform,
      record.type,
      record.title,
      record.context,
      record.decision,
      record.consequence,
      tagsJson,
      record.score,
      record.grade,
      record.sourceCwd,
      record.rawMarkdown,
      record.createdAt,
      record.updatedAt
    )

    return record
  }

  /**
   * List knowledge items with filtering and search
   */
  listItems(options: ListKnowledgeOptions = {}): { items: KnowledgeItem[], total: number } {
    cacheService.init()
    const db = cacheService.getDb()
    if (!db) return { items: [], total: 0 }

    try {
      const conditions: string[] = []
      const params: unknown[] = []

      if (options.type && options.type !== 'all') {
        conditions.push('type = ?')
        params.push(options.type)
      }

      if (options.platform && options.platform !== 'all') {
        conditions.push('platform = ?')
        params.push(options.platform)
      }

      if (options.tag) {
        conditions.push('tags LIKE ?')
        params.push(`%"${options.tag}"%`)
      }

      if (options.search) {
        conditions.push('(title LIKE ? OR context LIKE ? OR decision LIKE ? OR consequence LIKE ?)')
        const query = `%${options.search}%`
        params.push(query, query, query, query)
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      const countSql = `SELECT COUNT(*) as total FROM knowledge_vault ${whereClause}`
      const totalRow = db.prepare(countSql).get(...params) as { total: number }
      const total = totalRow?.total || 0

      const limit = options.limit || 50
      const offset = options.offset || 0

      const selectSql = `
        SELECT * FROM knowledge_vault
        ${whereClause}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `
      const rows = db.prepare(selectSql).all(...params, limit, offset) as KnowledgeRow[]

      const items = rows.map(r => this.rowToItem(r)).filter(Boolean) as KnowledgeItem[]
      return { items, total }
    } catch (err) {
      console.error('[Knowledge] Error listing items:', err)
      return { items: [], total: 0 }
    }
  }

  /**
   * Get single knowledge item by ID
   */
  getItem(id: string): KnowledgeItem | null {
    cacheService.init()
    const db = cacheService.getDb()
    if (!db) return null

    try {
      const row = db.prepare('SELECT * FROM knowledge_vault WHERE id = ?').get(id) as KnowledgeRow | undefined
      return this.rowToItem(row)
    } catch (err) {
      console.error('[Knowledge] Error getting item:', err)
      return null
    }
  }

  /**
   * Delete knowledge item by ID
   */
  deleteItem(id: string): boolean {
    cacheService.init()
    const db = cacheService.getDb()
    if (!db) return false

    try {
      const info = db.prepare('DELETE FROM knowledge_vault WHERE id = ?').run(id)
      return info.changes > 0
    } catch (err) {
      console.error('[Knowledge] Error deleting item:', err)
      return false
    }
  }

  /**
   * Save session evaluation report
   */
  saveEvaluation(report: QuantitativeEvaluationReport, platform: string): void {
    cacheService.init()
    const db = cacheService.getDb()
    if (!db) return

    try {
      db.prepare(`
        INSERT OR REPLACE INTO session_evaluations
          (session_id, platform, overall_score, grade, category, is_worth_saving,
           sub_scores_json, signals_json, summary_reason, evaluated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        report.sessionId,
        platform,
        report.overallScore,
        report.grade,
        report.category,
        report.isWorthSaving ? 1 : 0,
        JSON.stringify(report.subScores || {}),
        JSON.stringify(report.signals || []),
        report.summaryReason || '',
        report.evaluatedAt || Date.now()
      )
    } catch (err) {
      console.error('[Knowledge] Error saving evaluation:', err)
    }
  }

  /**
   * Get session evaluation report
   */
  getEvaluation(sessionId: string, platform: string): QuantitativeEvaluationReport | null {
    cacheService.init()
    const db = cacheService.getDb()
    if (!db) return null

    try {
      const row = db.prepare(
        'SELECT * FROM session_evaluations WHERE session_id = ? AND platform = ?'
      ).get(sessionId, platform) as EvaluationRow | undefined

      if (!row) return null

      return {
        sessionId: row.session_id,
        overallScore: row.overall_score,
        grade: row.grade as GradeLevel,
        category: row.category as ValueCategory,
        isWorthSaving: row.is_worth_saving === 1,
        suggestedAction: row.is_worth_saving === 1 ? 'auto_archive_adr' : 'search_index_only',
        subScores: JSON.parse(row.sub_scores_json || '{}') as QuantitativeEvaluationReport['subScores'],
        signals: JSON.parse(row.signals_json || '[]') as string[],
        summaryReason: row.summary_reason || '',
        evaluatedAt: row.evaluated_at
      }
    } catch (err) {
      console.error('[Knowledge] Error getting evaluation:', err)
      return null
    }
  }

  /**
   * Auto harvest high-value knowledge from session evaluation
   */
  autoHarvestFromEvaluation(
    session: UnifiedSession,
    report: QuantitativeEvaluationReport,
    messages: SessionMessage[] = []
  ): KnowledgeItem | null {
    if (!report.isWorthSaving || report.category === 'Trivial') return null

    // Extract rationale and context from messages
    const thoughtSnippets = messages.map(m => m.thought || '').filter(t => t.length > 20)
    const contextStr = thoughtSnippets.length > 0
      ? thoughtSnippets.slice(0, 2).join('\n---\n')
      : `来自 ${session.cli.toUpperCase()} 会话 [${session.title}]`

    const decisionStr = report.signals.join('；\n') || session.title
    const consequenceStr = `已在项目 ${session.cwd} 中落地并通过量化评估 (${report.overallScore}分·${report.grade}级)。`

    return this.saveItem({
      sessionId: session.id,
      platform: session.cli,
      type: report.category,
      title: session.title,
      context: contextStr,
      decision: decisionStr,
      consequences: consequenceStr,
      consequence: consequenceStr,
      tags: (session.extra?.tags as string[]) || [session.cli, report.category.toLowerCase()],
      score: report.overallScore,
      grade: report.grade,
      sourceCwd: session.cwd,
      rawMarkdown: this.formatItemToMarkdown({
        id: `kn_${Date.now()}`,
        sessionId: session.id,
        platform: session.cli,
        type: report.category,
        title: session.title,
        context: contextStr,
        decision: decisionStr,
        consequences: consequenceStr,
        consequence: consequenceStr,
        tags: (session.extra?.tags as string[]) || [],
        score: report.overallScore,
        grade: report.grade,
        sourceCwd: session.cwd,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
    })
  }

  /**
   * Format single knowledge item as standard Markdown (ADR / Gotcha)
   */
  formatItemToMarkdown(item: KnowledgeItem): string {
    return `# [${item.type}] ${item.title}

- **类型 (Type)**: \`${item.type}\`
- **评级 (Grade)**: \`${item.grade}\` (${item.score}分)
- **来源平台 (Platform)**: \`${String(item.platform).toUpperCase()}\`
- **工作目录 (Path)**: \`${item.sourceCwd || 'N/A'}\`
- **标签 (Tags)**: ${item.tags.map(t => `\`#${t}\``).join(' ') || '无'}
- **沉淀时间 (Created)**: ${new Date(item.createdAt).toLocaleString()}

---

## 📌 背景与痛点 (Context)
${item.context || '无详细背景描述'}

## 💡 决策与核心方案 (Decision / Solution)
${item.decision || '无方案详情'}

## 🎯 影响与落地结果 (Consequences / Outcome)
${item.consequences || item.consequence || '正常落地与维护'}
`
  }

  /**
   * Export multiple items to unified Markdown
   */
  exportMarkdown(ids?: string[], type?: string): string {
    const { items } = this.listItems({ type, limit: 200 })
    const targetItems = ids && ids.length > 0 ? items.filter(i => ids.includes(i.id)) : items

    if (targetItems.length === 0) return '# 暂无知识资产记录'

    return `# AI Session Hub — 知识资产库汇总导出
> 导出时间：${new Date().toLocaleString()} · 共 ${targetItems.length} 条资产

  ` + targetItems.map(item => this.formatItemToMarkdown(item)).join('\n\n---\n\n')
  }

  private rowToItem(row: KnowledgeRow | undefined): KnowledgeItem | null {
    if (!row) return null
    let tags: string[] = []
    try {
      tags = JSON.parse(row.tags || '[]') as string[]
    } catch {
      // corrupted tags json — default to empty
    }
    const csq = row.consequence || ''

    return {
      id: row.id,
      sessionId: row.session_id || '',
      platform: row.platform,
      type: row.type as ValueCategory,
      title: row.title,
      context: row.context || '',
      decision: row.decision || '',
      consequences: csq,
      consequence: csq,
      tags,
      score: row.score || 0,
      grade: (row.grade || 'A') as GradeLevel,
      sourceCwd: row.source_cwd || '',
      rawMarkdown: row.raw_markdown || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}

export const knowledgeService = new KnowledgeService()
