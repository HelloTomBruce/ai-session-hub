import { cacheService } from './cache-service'
import type { PlatformType } from './types'
import type { QuantitativeEvaluationReport, ValueCategory, GradeLevel } from '@session-hub/analyzer'

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
  strategy_json?: string
  flags_json?: string
  evaluator_version?: number
  harvest_status?: string
  memory_node_id?: string
  evidence_hash?: string
  evaluated_at: number
}

export type HarvestStatus = 'candidate' | 'extracted' | 'skipped'

class KnowledgeService {
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
  saveEvaluation(report: QuantitativeEvaluationReport, platform: string, evidenceHash = ''): void {
    cacheService.init()
    const db = cacheService.getDb()
    if (!db) return

    try {
      // INSERT OR REPLACE 会清空未列出的列，先取旧的 harvest 状态保持幂等
      const prev = db.prepare(
        'SELECT harvest_status, memory_node_id FROM session_evaluations WHERE session_id = ? AND platform = ?'
      ).get(report.sessionId, platform) as { harvest_status?: string, memory_node_id?: string } | undefined

      db.prepare(`
        INSERT OR REPLACE INTO session_evaluations
          (session_id, platform, overall_score, grade, category, is_worth_saving,
           sub_scores_json, signals_json, summary_reason,
           strategy_json, flags_json, evaluator_version, harvest_status, memory_node_id, evidence_hash, evaluated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify((report as { signalDetails?: unknown }).signalDetails || report.signals || []),
        JSON.stringify(report.flags || {}),
        report.evaluatorVersion || 2,
        prev?.harvest_status || '',
        prev?.memory_node_id || '',
        evidenceHash,
        report.evaluatedAt || Date.now()
      )
    } catch (err) {
      console.error('[Knowledge] Error saving evaluation:', err)
    }
  }

  /**
   * 沉淀完成后回写 harvest 状态与 Grafeo 记忆节点 id
   */
  updateHarvestResult(sessionId: string, platform: string, status: HarvestStatus, memoryNodeId = ''): void {
    cacheService.init()
    const db = cacheService.getDb()
    if (!db) return
    try {
      db.prepare(
        'UPDATE session_evaluations SET harvest_status = ?, memory_node_id = ? WHERE session_id = ? AND platform = ?'
      ).run(status, memoryNodeId, sessionId, platform)
    } catch (err) {
      console.error('[Knowledge] Error updating harvest result:', err)
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
        signalDetails: [],
        flags: this.parseJsonObject(row.flags_json || '{}', {}),
        vetoed: false,
        lowConfidence: false,
        evaluatorVersion: row.evaluator_version || 1,
        harvestStatus: row.harvest_status || '',
        memoryNodeId: row.memory_node_id || '',
        summaryReason: row.summary_reason || '',
        evaluatedAt: row.evaluated_at
      }
    } catch (err) {
      console.error('[Knowledge] Error getting evaluation:', err)
      return null
    }
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

  private parseJsonObject<T>(raw: string, fallback: T): T {
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
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
