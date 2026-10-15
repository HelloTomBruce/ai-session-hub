import { grafeoService } from './grafeo-service'
import { normalizeTitleForDedup, contentSimilarity } from './harvest-dedup'
import { recallStats } from './recall-stats'
import type {
  MemoryGraphItem,
  MemoryRecallItem,
  MemoryNodeData,
  MemoryGraphQueryOptions,
  GraphVisualizationData,
  ProjectEntity,
  TechConceptEntity,
  ProblemEntity,
  PatternSnippetEntity
} from './memory-types'

/** 同键写入互斥（内存级）：防止并发 saveMemoryWithDedup 双双 miss 产生重复节点 */
const memoryWriteChains = new Map<string, Promise<unknown>>()

export async function withMemoryWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = memoryWriteChains.get(key) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  memoryWriteChains.set(key, next)
  try {
    return await next
  } finally {
    if (memoryWriteChains.get(key) === next) memoryWriteChains.delete(key)
  }
}

/** Grafeo 返回的 Memory 节点原始属性（tags/sourceMeta 以 JSON 字符串存储） */
interface RawMemoryNode {
  id: string
  title?: string
  type?: string
  summary?: string
  content?: string
  confidence?: number
  tagsJson?: string
  sourceMetaJson?: string
  status?: string
  createdAt?: number
  updatedAt?: number
}

type MemoryRow = [
  RawMemoryNode | null,
  ProjectEntity | null,
  TechConceptEntity | null,
  ProblemEntity | null,
  PatternSnippetEntity | null,
  (RawMemoryNode | null)?
]

type GraphRow = [
  RawMemoryNode | null,
  ProjectEntity | null,
  TechConceptEntity | null,
  ProblemEntity | null,
  RawMemoryNode | null,
  ...unknown[]
]

type PairRow = [string | undefined, string | undefined]

/** 统一去重写入的动作语义 */
export type MemoryDedupAction = 'created' | 'updated-session' | 'updated-title' | 'superseded'

export interface SaveWithDedupResult {
  item: MemoryGraphItem
  dedup: MemoryDedupAction
}

class MemoryService {
  /**
   * 统一去重写入（P1 质量管线）：所有写入路径（评估沉淀/手动提炼/MCP）唯一入口。
   *
   * 去重语义（源自原 knowledge-harvest.persistDraft，收敛至此）：
   * 1. 同源会话去重：sourceMeta.sessionId+platform 命中 → 原地更新（updated-session）
   * 2. 同类型同规范化标题命中：
   *    - 内容相似度 ≥ 0.8 → 原地更新（updated-title）
   *    - 内容演进 → 新建 + SUPERSEDES 边（superseded）
   * 3. 无命中 → 新建（created）
   */
  async saveMemoryWithDedup(
    item: Partial<MemoryGraphItem> & { title: string, content: string },
    sessionKey?: { sessionId: string, platform: string }
  ): Promise<SaveWithDedupResult> {
    // 会话键回填：调用方未在 sourceMeta 中携带 sessionKey 时自动注入，
    // 保证「按 sessionKey 去重」与「节点记录的溯源信息」一致（旧实现二者会脱节）
    if (sessionKey?.sessionId && item.sourceMeta?.sessionId !== sessionKey.sessionId) {
      item = {
        ...item,
        sourceMeta: { ...item.sourceMeta, sessionId: sessionKey.sessionId, platform: sessionKey.platform }
      }
    }
    const normTitle = normalizeTitleForDedup(item.title)
    const type = item.type || 'BestPractice'
    // 同键串行化：带会话键的写入（评估沉淀/手工捕获主路径）按会话键互斥；
    // 无会话键的手工资产退化按 类型+标题 键互斥
    const lockKey = sessionKey?.sessionId
      ? `session:${sessionKey.platform}:${sessionKey.sessionId}`
      : `title:${type}:${normTitle}`
    return withMemoryWriteLock(lockKey, () =>
      this.saveMemoryWithDedupInner(item, sessionKey, type, normTitle)
    )
  }

  private async saveMemoryWithDedupInner(
    item: Partial<MemoryGraphItem> & { title: string, content: string },
    sessionKey: { sessionId: string, platform: string } | undefined,
    type: string,
    normTitle: string
  ): Promise<SaveWithDedupResult> {
    await grafeoService.init()

    // 1. 同源会话去重（sourceMetaJson 粗筛 + JS 精校，替代旧的全量 listMemories(500)）
    if (sessionKey?.sessionId) {
      const bySession = await this.findMemoryBySessionKey(sessionKey)
      if (bySession) {
        const saved = await this.saveMemory({ ...item, id: bySession.id, createdAt: bySession.createdAt })
        return { item: saved, dedup: 'updated-session' }
      }
    }

    // 2. 同类型同标题去重
    const byTitle = await this.findMemoryByTitle(type, normTitle)
    if (byTitle) {
      const sim = contentSimilarity(byTitle.content, item.content)
      if (sim >= 0.8) {
        const saved = await this.saveMemory({ ...item, id: byTitle.id, createdAt: byTitle.createdAt })
        return { item: saved, dedup: 'updated-title' }
      }
      // 内容演进：新建 + SUPERSEDES（合并调用方显式指定的 supersededIds，去重）
      const mergedSuperseded = Array.from(new Set([...(item.supersededIds || []), byTitle.id]))
      const saved = await this.saveMemory({ ...item, supersededIds: mergedSuperseded })
      return { item: saved, dedup: 'superseded' }
    }

    const saved = await this.saveMemory(item)
    return { item: saved, dedup: 'created' }
  }

  /**
   * 定向查询：同源会话记忆（sourceMetaJson CONTAINS 粗筛 + JS 精校 platform/sessionId）
   */
  private async findMemoryBySessionKey(sessionKey: { sessionId: string, platform: string }): Promise<MemoryGraphItem | null> {
    try {
      const res = await grafeoService.execute(
        `MATCH (m:Memory) WHERE m.sourceMetaJson CONTAINS $sessionId RETURN m`,
        { sessionId: sessionKey.sessionId }
      )
      const rows = (res.rows() || []) as unknown as Array<[RawMemoryNode | null]>
      for (const [m] of rows) {
        if (!m?.id) continue
        const candidate = this.formatMemoryNode(m)
        if (
          candidate.sourceMeta?.sessionId === sessionKey.sessionId
          && candidate.sourceMeta?.platform === sessionKey.platform
        ) {
          return candidate
        }
      }
      return null
    } catch (err) {
      console.error('[MemoryService] Error in findMemoryBySessionKey:', err)
      return null
    }
  }

  /**
   * 定向查询：同类型同规范化标题记忆（lower() 粗筛 + JS normalizeTitleForDedup 精校）
   */
  private async findMemoryByTitle(type: string, normTitle: string): Promise<MemoryGraphItem | null> {
    try {
      const res = await grafeoService.execute(
        `MATCH (m:Memory) WHERE m.type = $type AND lower(m.title) = $lowerTitle RETURN m`,
        { type, lowerTitle: normTitle }
      )
      const rows = (res.rows() || []) as unknown as Array<[RawMemoryNode | null]>
      for (const [m] of rows) {
        if (!m?.id) continue
        const candidate = this.formatMemoryNode(m)
        if (normalizeTitleForDedup(candidate.title) === normTitle) return candidate
      }
      return null
    } catch (err) {
      console.error('[MemoryService] Error in findMemoryByTitle:', err)
      return null
    }
  }

  /**
   * 保存或更新图记忆（含实体与拓扑关系）
   *
   * 事务语义：节点 upsert 与关系重建在单个 Grafeo 事务内完成，失败整体回滚。
   * 旧实现「DETACH DELETE + CREATE」分两条语句且无事务——中间失败即丢数据，
   * 且 DETACH DELETE 会切断其他记忆指向本节点的 SUPERSEDES 演进边；
   * 现改为 MERGE + SET（保留节点身份与入边），仅清理本节点出边后重建。
   */
  async saveMemory(item: Partial<MemoryGraphItem> & { title: string, content: string }): Promise<MemoryGraphItem> {
    await grafeoService.init()
    const db = grafeoService.getDb()
    const now = Date.now()
    const id = item.id || `mem_${now}_${Math.random().toString(36).slice(2, 7)}`
    const type = item.type || 'BestPractice'
    // 标题规范化存储（trim + 折叠连续空白）：保证 Cypher 层 lower() 粗筛与
    // JS 层 normalizeTitleForDedup 精校一致，空白变体标题不再漏判
    const title = item.title.trim().replace(/\s+/g, ' ')
    const summary = item.summary || title
    const confidence = typeof item.confidence === 'number' ? item.confidence : 90
    const tags = Array.isArray(item.tags) ? item.tags : []
    const tagsJson = JSON.stringify(tags)
    const sourceMetaJson = JSON.stringify(item.sourceMeta || {})
    // P2 状态分层：draft（低置信/证据存疑，不进召回）| confirmed（默认）
    const status = item.status === 'draft' ? 'draft' : 'confirmed'

    // createdAt 保留：优先调用方显式指定，其次库内既有值（修复更新路径重置演进历史）
    let existingCreatedAt: number | null = null
    if (!item.createdAt) {
      try {
        const res = await db.execute('MATCH (m:Memory {id: $id}) RETURN m.createdAt', { id })
        const rows = (res.rows() || []) as unknown as Array<[unknown]>
        existingCreatedAt = rows.length > 0 ? Number(rows[0]?.[0]) || null : null
      } catch {
        existingCreatedAt = null
      }
    }
    const createdAt = item.createdAt || existingCreatedAt || now
    const updatedAt = now

    const tx = db.beginTransaction()
    const run = (query: string, params?: Record<string, unknown>) => tx.execute(query, params)

    try {
      // 1. 原子 upsert Memory 核心节点（MERGE 保留入边与节点身份）
      await run(
        `
        MERGE (m:Memory {id: $id})
        SET m.title = $title, m.type = $type, m.summary = $summary, m.content = $content,
            m.confidence = $confidence, m.tagsJson = $tagsJson, m.sourceMetaJson = $sourceMetaJson,
            m.status = $status, m.createdAt = $createdAt, m.updatedAt = $updatedAt
      `,
        {
          id,
          title,
          type,
          summary,
          content: item.content,
          confidence,
          tagsJson,
          sourceMetaJson,
          status,
          createdAt,
          updatedAt
        }
      )

      // 2. 清理本节点出边（保留其他记忆指向本节点的 SUPERSEDES 入边）。
      // 注意：不可用 OPTIONAL MATCH——Grafeo 对 null 边绑定的结果集物化会报
      // "edge column 1" 错误；无出边时节点不命中任何行，语义等价且安全。
      await run(
        `
        MATCH (m:Memory {id: $id})-[r]->()
        DELETE r
      `,
        { id }
      )

      // 3. 关联 Project
      const projects: ProjectEntity[] = item.projects || []
      for (const p of projects) {
        if (!p.name) continue
        await run(
          `MERGE (proj:Project {name: $name})`,
          { name: p.name }
        )
        if (p.cwd) {
          await run(
            `MATCH (proj:Project {name: $name}) SET proj.cwd = $cwd`,
            { name: p.name, cwd: p.cwd }
          )
        }
        await run(
          `MATCH (m:Memory {id: $id}), (proj:Project {name: $name}) CREATE (m)-[:APPLIES_TO]->(proj)`,
          { id, name: p.name }
        )
      }

      // 4. 关联 TechConcept
      const techConcepts: TechConceptEntity[] = item.techConcepts || []
      for (const t of techConcepts) {
        if (!t.name) continue
        await run(
          `MERGE (tc:TechConcept {name: $name})`,
          { name: t.name }
        )
        if (t.category) {
          await run(
            `MATCH (tc:TechConcept {name: $name}) SET tc.category = $category`,
            { name: t.name, category: t.category }
          )
        }
        await run(
          `MATCH (m:Memory {id: $id}), (tc:TechConcept {name: $name}) CREATE (m)-[:RELATES_TO]->(tc)`,
          { id, name: t.name }
        )
      }

      // 5. 关联 Problem
      const problems: ProblemEntity[] = item.problems || []
      for (const prob of problems) {
        if (!prob.title) continue
        await run(
          `MERGE (pb:Problem {title: $title})`,
          { title: prob.title }
        )
        if (prob.symptom || prob.errorCode) {
          await run(
            `MATCH (pb:Problem {title: $title}) SET pb.symptom = $symptom, pb.errorCode = $errorCode`,
            { title: prob.title, symptom: prob.symptom || '', errorCode: prob.errorCode || '' }
          )
        }
        await run(
          `MATCH (m:Memory {id: $id}), (pb:Problem {title: $title}) CREATE (m)-[:SOLVES]->(pb)`,
          { id, title: prob.title }
        )
      }

      // 6. 关联 Snippet
      const snippets: PatternSnippetEntity[] = item.snippets || []
      for (const snip of snippets) {
        if (!snip.code) continue
        await run(
          `CREATE (ps:PatternSnippet {
            title: $title,
            code: $code,
            language: $language,
            rules: $rules
          })`,
          {
            title: snip.title || '',
            code: snip.code,
            language: snip.language || '',
            rules: snip.rules || ''
          }
        )
        await run(
          `MATCH (m:Memory {id: $id}), (ps:PatternSnippet {code: $code}) CREATE (m)-[:PRODUCES]->(ps)`,
          { id, code: snip.code }
        )
      }

      // 7. 关联演进覆盖 (SUPERSEDES)
      const supersededIds = item.supersededIds || []
      for (const oldId of supersededIds) {
        if (!oldId || oldId === id) continue
        await run(
          `
          MATCH (m:Memory {id: $id}), (old:Memory {id: $oldId})
          CREATE (m)-[:SUPERSEDES]->(old)
        `,
          { id, oldId }
        )
      }

      tx.commit()
    } catch (err) {
      try {
        tx.rollback()
      } catch {
        // 事务可能已失效，忽略二次回滚错误
      }
      throw err
    }

    grafeoService.checkpoint()

    return {
      id,
      title,
      type,
      summary,
      content: item.content,
      confidence,
      tags,
      sourceMeta: item.sourceMeta,
      status,
      createdAt,
      updatedAt,
      projects: item.projects || [],
      techConcepts: item.techConcepts || [],
      problems: item.problems || [],
      snippets: item.snippets || [],
      supersededIds: item.supersededIds || []
    }
  }

  /**
   * 根据 ID 获取完整图记忆节点及拓扑关联
   */
  async getMemory(id: string): Promise<MemoryGraphItem | null> {
    await grafeoService.init()
    // P3 闭环：记录实际拉取（区别于召回命中，权重更高）
    recallStats.logUse(id)
    try {
      const res = await grafeoService.execute(
        `
        MATCH (m:Memory {id: $id})
        OPTIONAL MATCH (m)-[:APPLIES_TO]->(p:Project)
        OPTIONAL MATCH (m)-[:RELATES_TO]->(t:TechConcept)
        OPTIONAL MATCH (m)-[:SOLVES]->(pb:Problem)
        OPTIONAL MATCH (m)-[:PRODUCES]->(ps:PatternSnippet)
        OPTIONAL MATCH (m)-[:SUPERSEDES]->(old:Memory)
        RETURN m, p, t, pb, ps, old
      `,
        { id }
      )

      // SAFETY: Grafeo 返回的行结构为 [m, p, t, pb, ps, ...]，与 MemoryRow 元组一致；列缺省时为 null，下游已做空值过滤。
      const rows = (res.rows() || []) as unknown as MemoryRow[]
      if (rows.length === 0) return null

      let mNode: RawMemoryNode | null = null
      const projectsMap = new Map<string, ProjectEntity>()
      const techMap = new Map<string, TechConceptEntity>()
      const problemMap = new Map<string, ProblemEntity>()
      const snippetMap = new Map<string, PatternSnippetEntity>()
      const supersededSet = new Set<string>()

      for (const row of rows) {
        // row is [m, p, t, pb, ps, old]
        const [m, p, t, pb, ps, old] = row
        if (m && !mNode) mNode = m
        if (p && p.name) projectsMap.set(p.name, { name: p.name, cwd: p.cwd || '' })
        if (t && t.name) techMap.set(t.name, { name: t.name, category: t.category || 'other' })
        if (pb && pb.title) problemMap.set(pb.title, { title: pb.title, symptom: pb.symptom, errorCode: pb.errorCode })
        if (ps && ps.code) snippetMap.set(ps.code, { title: ps.title, code: ps.code, language: ps.language, rules: ps.rules })
        if (old && old.id) supersededSet.add(old.id)
      }

      if (!mNode) return null

      return this.formatMemoryNode(
        mNode,
        Array.from(projectsMap.values()),
        Array.from(techMap.values()),
        Array.from(problemMap.values()),
        Array.from(snippetMap.values()),
        Array.from(supersededSet)
      )
    } catch (err) {
      console.error('[MemoryService] Error getting memory:', err)
      return null
    }
  }

  /**
   * 列表检索记忆（支持类型、项目、技术栈、关键词搜索）
   */
  async listMemories(options: MemoryGraphQueryOptions = {}): Promise<{ items: MemoryGraphItem[], total: number }> {
    await grafeoService.init()
    try {
      const whereClauses: string[] = []
      const params: Record<string, unknown> = {}

      if (options.type && options.type !== 'all') {
        whereClauses.push('m.type = $type')
        params.type = options.type
      }

      if (options.project) {
        whereClauses.push('p.name = $project')
        params.project = options.project
      }

      if (options.cwd) {
        whereClauses.push('p.cwd CONTAINS $cwd')
        params.cwd = options.cwd
      }

      if (options.tech) {
        whereClauses.push('t.name = $tech')
        params.tech = options.tech
      }

      const filterStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

      const query = `
        MATCH (m:Memory)
        OPTIONAL MATCH (m)-[:APPLIES_TO]->(p:Project)
        OPTIONAL MATCH (m)-[:RELATES_TO]->(t:TechConcept)
        OPTIONAL MATCH (m)-[:SOLVES]->(pb:Problem)
        OPTIONAL MATCH (m)-[:PRODUCES]->(ps:PatternSnippet)
        ${filterStr}
        RETURN m, p, t, pb, ps
        ORDER BY m.updatedAt DESC
      `

      const res = await grafeoService.execute(query, params)
      // SAFETY: Grafeo 返回的行结构为 [m, p, t, pb, ps, ...]，与 MemoryRow 元组一致；列缺省时为 null，下游已做空值过滤。
      const rows = (res.rows() || []) as unknown as MemoryRow[]
      if (rows.length === 0) return { items: [], total: 0 }

      const memoriesMap = new Map<
        string,
        {
          mNode: RawMemoryNode
          projects: Map<string, ProjectEntity>
          tech: Map<string, TechConceptEntity>
          problems: Map<string, ProblemEntity>
          snippets: Map<string, PatternSnippetEntity>
        }
      >()

      for (const row of rows) {
        const [m, p, t, pb, ps] = row
        if (!m || !m.id) continue

        if (!memoriesMap.has(m.id)) {
          memoriesMap.set(m.id, {
            mNode: m,
            projects: new Map(),
            tech: new Map(),
            problems: new Map(),
            snippets: new Map()
          })
        }

        const entry = memoriesMap.get(m.id)!
        if (p && p.name) entry.projects.set(p.name, { name: p.name, cwd: p.cwd || '' })
        if (t && t.name) entry.tech.set(t.name, { name: t.name, category: t.category || 'other' })
        if (pb && pb.title) entry.problems.set(pb.title, { title: pb.title, symptom: pb.symptom, errorCode: pb.errorCode })
        if (ps && ps.code) entry.snippets.set(ps.code, { title: ps.title, code: ps.code, language: ps.language, rules: ps.rules })
      }

      let items: MemoryGraphItem[] = []
      for (const entry of memoriesMap.values()) {
        const item = this.formatMemoryNode(
          entry.mNode,
          Array.from(entry.projects.values()),
          Array.from(entry.tech.values()),
          Array.from(entry.problems.values()),
          Array.from(entry.snippets.values())
        )
        items.push(item)
      }

      // 客户端/内存层关键词模糊过滤（应对混合检索）
      if (options.search) {
        const q = options.search.toLowerCase()
        items = items.filter(
          item =>
            item.title.toLowerCase().includes(q)
            || item.summary.toLowerCase().includes(q)
            || item.content.toLowerCase().includes(q)
            || item.tags.some(t => t.toLowerCase().includes(q))
            || item.techConcepts.some(t => t.name.toLowerCase().includes(q))
            || item.problems.some(p => p.title.toLowerCase().includes(q))
        )
      }

      const total = items.length
      const offset = options.offset || 0
      const limit = options.limit || 50
      const paginated = items.slice(offset, offset + limit)

      return { items: paginated, total }
    } catch (err) {
      console.error('[MemoryService] Error listing memories:', err)
      return { items: [], total: 0 }
    }
  }

  /**
   * 删除指定记忆及关联边
   */
  async deleteMemory(id: string): Promise<boolean> {
    await grafeoService.init()
    try {
      await grafeoService.execute(
        `
        MATCH (m:Memory {id: $id})
        DETACH DELETE m
      `,
        { id }
      )
      grafeoService.checkpoint()
      return true
    } catch (err) {
      console.error('[MemoryService] Error deleting memory:', err)
      return false
    }
  }

  /**
   * 获取用于前端可视化拓扑图谱的数据 (Nodes & Edges)
   */
  async getGraphData(options: { type?: string, project?: string, limit?: number } = {}): Promise<GraphVisualizationData> {
    await grafeoService.init()
    try {
      const whereClauses: string[] = []
      const params: Record<string, unknown> = {}

      if (options.type && options.type !== 'all') {
        whereClauses.push('m.type = $type')
        params.type = options.type
      }

      if (options.project && options.project !== 'all') {
        // 依赖 OPTIONAL MATCH 出的 p：没有关联该项目的 Memory 行在此被过滤
        whereClauses.push('p.name = $project')
        params.project = options.project
      }

      const filterStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
      // LIMIT 不支持参数化，此处先收敛为安全整数（截断小数 + 钳位）再内联
      const limit = Math.trunc(Math.min(Math.max(Number(options.limit) || 200, 1), 500))

      const res = await grafeoService.execute(`
        MATCH (m:Memory)
        OPTIONAL MATCH (m)-[r1:APPLIES_TO]->(p:Project)
        OPTIONAL MATCH (m)-[r2:RELATES_TO]->(t:TechConcept)
        OPTIONAL MATCH (m)-[r3:SOLVES]->(pb:Problem)
        OPTIONAL MATCH (m)-[r4:SUPERSEDES]->(old:Memory)
        ${filterStr}
        RETURN m, p, t, pb, old, r1, r2, r3, r4
        LIMIT ${limit}
      `, params)

      // SAFETY: Grafeo 返回的行结构为 [m, p, t, pb, m2, ...]，与 GraphRow 元组一致；列缺省时为 null。
      const rows = (res.rows() || []) as unknown as GraphRow[]
      const nodesMap = new Map<string, GraphVisualizationData['nodes'][0]>()
      const edgesMap = new Map<string, GraphVisualizationData['edges'][0]>()

      // 颜色与分类映射
      const typeColors: Record<string, string> = {
        ADR: '#3b82f6', // blue
        Gotcha: '#ef4444', // red
        BestPractice: '#10b981', // green
        Pattern: '#8b5cf6', // purple
        Workflow: '#f59e0b', // amber
        Config: '#06b6d4', // cyan
        Security: '#e11d48', // rose
        Performance: '#ec4899', // pink
        ApiSpec: '#6366f1' // indigo
      }

      for (const row of rows) {
        const [m, p, t, pb, old] = row
        if (!m || !m.id) continue

        // Memory 节点
        if (!nodesMap.has(m.id)) {
          const color = typeColors[m.type || ''] || '#64748b'
          nodesMap.set(m.id, {
            id: m.id,
            label: 'Memory',
            name: m.title || m.id,
            type: m.type,
            color,
            data: {
              type: m.type,
              summary: m.summary,
              confidence: m.confidence,
              updatedAt: m.updatedAt
            }
          })
        }

        // Project 节点
        if (p && p.name) {
          const pId = `proj_${p.name}`
          if (!nodesMap.has(pId)) {
            nodesMap.set(pId, {
              id: pId,
              label: 'Project',
              name: p.name,
              color: '#0284c7',
              data: { cwd: p.cwd }
            })
          }
          const edgeId = `${m.id}->${pId}`
          edgesMap.set(edgeId, {
            id: edgeId,
            source: m.id,
            target: pId,
            label: 'APPLIES_TO',
            type: 'APPLIES_TO'
          })
        }

        // TechConcept 节点
        if (t && t.name) {
          const tId = `tech_${t.name}`
          if (!nodesMap.has(tId)) {
            nodesMap.set(tId, {
              id: tId,
              label: 'TechConcept',
              name: t.name,
              color: '#10b981',
              data: { category: t.category }
            })
          }
          const edgeId = `${m.id}->${tId}`
          edgesMap.set(edgeId, {
            id: edgeId,
            source: m.id,
            target: tId,
            label: 'RELATES_TO',
            type: 'RELATES_TO'
          })
        }

        // Problem 节点
        if (pb && pb.title) {
          const pbId = `prob_${pb.title.slice(0, 30)}`
          if (!nodesMap.has(pbId)) {
            nodesMap.set(pbId, {
              id: pbId,
              label: 'Problem',
              name: pb.title,
              color: '#f43f5e',
              data: { symptom: pb.symptom, errorCode: pb.errorCode }
            })
          }
          const edgeId = `${m.id}->${pbId}`
          edgesMap.set(edgeId, {
            id: edgeId,
            source: m.id,
            target: pbId,
            label: 'SOLVES',
            type: 'SOLVES'
          })
        }

        // Supersedes 关系
        if (old && old.id) {
          const edgeId = `${m.id}-SUPERSEDES->${old.id}`
          edgesMap.set(edgeId, {
            id: edgeId,
            source: m.id,
            target: old.id,
            label: 'SUPERSEDES',
            type: 'SUPERSEDES'
          })
        }
      }

      const nodes = Array.from(nodesMap.values())
      const nodeIds = new Set(nodes.map(n => n.id))
      // 丢弃端点不在当前结果集内的边（SUPERSEDES 目标可能已被过滤或截断）
      const edges = Array.from(edgesMap.values()).filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))

      return { nodes, edges }
    } catch (err) {
      console.error('[MemoryService] Error getting graph data:', err)
      return { nodes: [], edges: [] }
    }
  }

  /**
   * 获取知识图谱元数据（动态提取已存在的所有类型、项目、技术栈与统计）
   */
  async getDistinctMeta(): Promise<{
    types: Array<{ name: string, count: number }>
    projects: ProjectEntity[]
    techConcepts: TechConceptEntity[]
    total: number
  }> {
    await grafeoService.init()
    try {
      // 1. 统计各类型数量
      const typeRes = await grafeoService.execute('MATCH (m:Memory) RETURN m.type AS type')
      // SAFETY: 查询 RETURN 单列 type，Grafeo 行即 [type]，与 PairRow 形状兼容。
      const typeRows = (typeRes.rows() || []) as unknown as PairRow[]
      const typeCountMap = new Map<string, number>()
      let total = 0

      for (const row of typeRows) {
        const typeName = row[0] || 'Other'
        typeCountMap.set(typeName, (typeCountMap.get(typeName) || 0) + 1)
        total++
      }

      const types = Array.from(typeCountMap.entries()).map(([name, count]) => ({
        name,
        count
      }))

      // 2. 获取所有项目
      const projRes = await grafeoService.execute('MATCH (p:Project) RETURN p.name AS name, p.cwd AS cwd')
      // SAFETY: 查询 RETURN name, cwd 两列，与 PairRow 形状一致。
      const projRows = (projRes.rows() || []) as unknown as PairRow[]
      const projectMap = new Map<string, ProjectEntity>()
      for (const row of projRows) {
        const [name, cwd] = row
        if (name && !projectMap.has(name)) {
          projectMap.set(name, { name, cwd: cwd || '' })
        }
      }

      // 3. 获取所有技术概念
      const techRes = await grafeoService.execute('MATCH (t:TechConcept) RETURN t.name AS name, t.category AS category')
      // SAFETY: 查询 RETURN name, category 两列，与 PairRow 形状一致。
      const techRows = (techRes.rows() || []) as unknown as PairRow[]
      const techMap = new Map<string, TechConceptEntity>()
      for (const row of techRows) {
        const [name, category] = row
        if (name && !techMap.has(name)) {
          techMap.set(name, { name, category: category || 'other' })
        }
      }

      return {
        types,
        projects: Array.from(projectMap.values()),
        techConcepts: Array.from(techMap.values()),
        total
      }
    } catch (err) {
      console.error('[MemoryService] Error getting distinct meta:', err)
      return { types: [], projects: [], techConcepts: [], total: 0 }
    }
  }

  /**
   * 针对开发场景的智能记忆召回 (MCP & Agent 上下文注入)
   */
  async recallMemories(params: {
    query?: string
    cwd?: string
    tech?: string[]
    type?: string
    limit?: number
    /** 调用来源标识（mcp / rest），用于召回事件归因 */
    source?: string
  }): Promise<MemoryRecallItem[]> {
    const { items } = await this.listMemories({
      type: params.type,
      cwd: params.cwd,
      search: params.query,
      limit: params.limit || 10
    })

    // P2 质量门：draft（低置信/证据存疑）不进召回，仅在 memory 页可见可提升
    const recallable = items.filter(item => item.status !== 'draft')

    // P3 时效治理：被新版本 SUPERSEDES 的旧节点退出召回（演进链由新版承接）
    const supersededOldIds = await this.getSupersededIds()
    const active = supersededOldIds.size > 0
      ? recallable.filter(item => !supersededOldIds.has(item.id))
      : recallable

    // 如果指定了 tech，优先排序匹配技术栈的条目
    if (params.tech && params.tech.length > 0) {
      const techSet = new Set(params.tech.map(t => t.toLowerCase()))
      active.sort((a, b) => {
        const aMatches = a.techConcepts.filter(t => techSet.has(t.name.toLowerCase())).length
        const bMatches = b.techConcepts.filter(t => techSet.has(t.name.toLowerCase())).length
        return bMatches - aMatches
      })
    }

    // P3 质量分融合：confidence 40% + 命中/使用/反馈 40% + 时效 20%
    const statsMap = recallStats.getAll()
    const now = Date.now()
    const qualityOf = (item: MemoryGraphItem): number => {
      const conf = Math.min(100, Math.max(0, item.confidence)) / 100
      const s = statsMap.get(item.id)
      const feedback = s ? (s.useful - s.not_useful) : 0
      const engagement = s
        ? Math.min(1, (s.recall_count * 0.05 + s.use_count * 0.15 + Math.max(0, feedback) * 0.25))
        : 0
      const ageDays = (now - item.updatedAt) / 86_400_000
      const freshness = Math.exp(-ageDays / 90) // 90 天半衰期
      return conf * 0.4 + engagement * 0.4 + freshness * 0.2
    }
    active.sort((a, b) => qualityOf(b) - qualityOf(a))

    const limited = active.slice(0, params.limit || 10)
    // P3 闭环：记录召回命中（供后续质量分与热度统计）
    recallStats.logRecall(limited.map(item => item.id))
    // 召回效果度量（曝光侧）：记录本次调用的 cwd/来源等上下文，供摩擦率归因分析
    recallStats.logRecallEvent({
      cwd: params.cwd,
      type: params.type,
      query: params.query,
      memoryIds: limited.map(item => item.id),
      source: params.source
    })

    return limited.map(item => this.toRecallItem(item))
  }

  /** P3：被新版本覆盖（SUPERSEDES 入边）的记忆 id 集合 */
  private async getSupersededIds(): Promise<Set<string>> {
    await grafeoService.init()
    try {
      const res = await grafeoService.execute(
        `MATCH (old:Memory)<-[:SUPERSEDES]-(:Memory) RETURN DISTINCT old.id AS id`
      )
      const rows = Array.isArray(res) ? res : ((res as { records?: unknown[] })?.records ?? [])
      const ids = new Set<string>()
      for (const row of rows as Array<{ id?: string } | Record<string, unknown>>) {
        const id = (row as { id?: string })?.id
        if (id) ids.add(id)
      }
      return ids
    } catch {
      return new Set()
    }
  }

  /**
   * P2 状态提升：draft → confirmed（memory 页人工确认入口）
   */
  async confirmMemory(id: string): Promise<boolean> {
    await grafeoService.init()
    try {
      await grafeoService.execute(
        `MATCH (m:Memory {id: $id}) SET m.status = 'confirmed', m.updatedAt = $updatedAt`,
        { id, updatedAt: Date.now() }
      )
      grafeoService.checkpoint()
      return true
    } catch (err) {
      console.error('[MemoryService] Error confirming memory:', err)
      return false
    }
  }

  /**
   * 裁剪为召回轻量项：去掉 content / snippets / supersededIds 等大字段，
   * 供 MCP recall_memories 与 REST /api/memory/recall 返回。
   * 完整内容通过 getMemory(id) 拉取。
   */
  private toRecallItem(item: MemoryGraphItem): MemoryRecallItem {
    return {
      id: item.id,
      title: item.title,
      type: item.type,
      summary: item.summary,
      confidence: item.confidence,
      tags: item.tags,
      updatedAt: item.updatedAt,
      projects: item.projects.map(p => ({ name: p.name, cwd: p.cwd })),
      techConcepts: item.techConcepts.map(t => ({ name: t.name, category: t.category })),
      problems: item.problems.map(p => ({ title: p.title }))
    }
  }

  private formatMemoryNode(
    m: RawMemoryNode,
    projects: ProjectEntity[] = [],
    techConcepts: TechConceptEntity[] = [],
    problems: ProblemEntity[] = [],
    snippets: PatternSnippetEntity[] = [],
    supersededIds: string[] = []
  ): MemoryGraphItem {
    let tags: string[]
    let sourceMeta: MemoryNodeData['sourceMeta']

    try {
      tags = JSON.parse(m.tagsJson || '[]')
    } catch {
      tags = []
    }

    try {
      sourceMeta = JSON.parse(m.sourceMetaJson || '{}')
    } catch {
      sourceMeta = {}
    }

    return {
      id: m.id,
      title: m.title || '',
      type: m.type || 'BestPractice',
      summary: m.summary || '',
      content: m.content || '',
      confidence: m.confidence || 90,
      tags,
      sourceMeta,
      // 存量节点（P2 前写入）无 status 属性，视为 confirmed
      status: m.status === 'draft' ? 'draft' : 'confirmed',
      createdAt: Number(m.createdAt) || Date.now(),
      updatedAt: Number(m.updatedAt) || Date.now(),
      projects,
      techConcepts,
      problems,
      snippets,
      supersededIds
    }
  }
}

export const memoryService = new MemoryService()
