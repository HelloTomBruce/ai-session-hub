import { grafeoService } from './grafeo-service'
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

class MemoryService {
  /**
   * 保存或更新图记忆（含实体与拓扑关系）
   */
  async saveMemory(item: Partial<MemoryGraphItem> & { title: string, content: string }): Promise<MemoryGraphItem> {
    await grafeoService.init()
    const now = Date.now()
    const id = item.id || `mem_${now}_${Math.random().toString(36).slice(2, 7)}`
    const type = item.type || 'BestPractice'
    const summary = item.summary || item.title
    const confidence = typeof item.confidence === 'number' ? item.confidence : 90
    const tags = Array.isArray(item.tags) ? item.tags : []
    const tagsJson = JSON.stringify(tags)
    const sourceMetaJson = JSON.stringify(item.sourceMeta || {})
    const createdAt = item.createdAt || now
    const updatedAt = now

    // 1. 创建或更新 Memory 核心节点（若存在先清除旧关系再重建）
    await grafeoService.execute(
      `
      MATCH (m:Memory {id: $id})
      DETACH DELETE m
    `,
      { id }
    )

    await grafeoService.execute(
      `
      CREATE (m:Memory {
        id: $id,
        title: $title,
        type: $type,
        summary: $summary,
        content: $content,
        confidence: $confidence,
        tagsJson: $tagsJson,
        sourceMetaJson: $sourceMetaJson,
        createdAt: $createdAt,
        updatedAt: $updatedAt
      })
    `,
      {
        id,
        title: item.title,
        type,
        summary,
        content: item.content,
        confidence,
        tagsJson,
        sourceMetaJson,
        createdAt,
        updatedAt
      }
    )

    // 2. 关联 Project
    const projects: ProjectEntity[] = item.projects || []
    for (const p of projects) {
      if (!p.name) continue
      await grafeoService.execute(
        `MERGE (proj:Project {name: $name})`,
        { name: p.name }
      )
      if (p.cwd) {
        await grafeoService.execute(
          `MATCH (proj:Project {name: $name}) SET proj.cwd = $cwd`,
          { name: p.name, cwd: p.cwd }
        )
      }
      await grafeoService.execute(
        `MATCH (m:Memory {id: $id}), (proj:Project {name: $name}) CREATE (m)-[:APPLIES_TO]->(proj)`,
        { id, name: p.name }
      )
    }

    // 3. 关联 TechConcept
    const techConcepts: TechConceptEntity[] = item.techConcepts || []
    for (const t of techConcepts) {
      if (!t.name) continue
      await grafeoService.execute(
        `MERGE (tc:TechConcept {name: $name})`,
        { name: t.name }
      )
      if (t.category) {
        await grafeoService.execute(
          `MATCH (tc:TechConcept {name: $name}) SET tc.category = $category`,
          { name: t.name, category: t.category }
        )
      }
      await grafeoService.execute(
        `MATCH (m:Memory {id: $id}), (tc:TechConcept {name: $name}) CREATE (m)-[:RELATES_TO]->(tc)`,
        { id, name: t.name }
      )
    }

    // 4. 关联 Problem
    const problems: ProblemEntity[] = item.problems || []
    for (const prob of problems) {
      if (!prob.title) continue
      await grafeoService.execute(
        `MERGE (pb:Problem {title: $title})`,
        { title: prob.title }
      )
      if (prob.symptom || prob.errorCode) {
        await grafeoService.execute(
          `MATCH (pb:Problem {title: $title}) SET pb.symptom = $symptom, pb.errorCode = $errorCode`,
          { title: prob.title, symptom: prob.symptom || '', errorCode: prob.errorCode || '' }
        )
      }
      await grafeoService.execute(
        `MATCH (m:Memory {id: $id}), (pb:Problem {title: $title}) CREATE (m)-[:SOLVES]->(pb)`,
        { id, title: prob.title }
      )
    }

    // 5. 关联 Snippet
    const snippets: PatternSnippetEntity[] = item.snippets || []
    for (const snip of snippets) {
      if (!snip.code) continue
      await grafeoService.execute(
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
      await grafeoService.execute(
        `MATCH (m:Memory {id: $id}), (ps:PatternSnippet {code: $code}) CREATE (m)-[:PRODUCES]->(ps)`,
        { id, code: snip.code }
      )
    }

    // 6. 关联演进覆盖 (SUPERSEDES)
    const supersededIds = item.supersededIds || []
    for (const oldId of supersededIds) {
      if (!oldId || oldId === id) continue
      await grafeoService.execute(
        `
        MATCH (m:Memory {id: $id}), (old:Memory {id: $oldId})
        CREATE (m)-[:SUPERSEDES]->(old)
      `,
        { id, oldId }
      )
    }

    grafeoService.checkpoint()

    return {
      id,
      title: item.title,
      type,
      summary,
      content: item.content,
      confidence,
      tags,
      sourceMeta: item.sourceMeta,
      createdAt,
      updatedAt,
      projects,
      techConcepts,
      problems,
      snippets,
      supersededIds
    }
  }

  /**
   * 根据 ID 获取完整图记忆节点及拓扑关联
   */
  async getMemory(id: string): Promise<MemoryGraphItem | null> {
    await grafeoService.init()
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
  }): Promise<MemoryRecallItem[]> {
    const { items } = await this.listMemories({
      type: params.type,
      cwd: params.cwd,
      search: params.query,
      limit: params.limit || 10
    })

    // 如果指定了 tech，优先排序匹配技术栈的条目
    if (params.tech && params.tech.length > 0) {
      const techSet = new Set(params.tech.map(t => t.toLowerCase()))
      items.sort((a, b) => {
        const aMatches = a.techConcepts.filter(t => techSet.has(t.name.toLowerCase())).length
        const bMatches = b.techConcepts.filter(t => techSet.has(t.name.toLowerCase())).length
        return bMatches - aMatches
      })
    }

    return items.map(item => this.toRecallItem(item))
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
