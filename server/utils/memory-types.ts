/**
 * AI Session Hub - 记忆图谱模块数据结构与类型定义
 */

export type PresetMemoryType
  = | 'ADR'
    | 'Gotcha'
    | 'BestPractice'
    | 'Pattern'
    | 'Workflow'
    | 'Config'
    | 'Security'
    | 'Performance'
    | 'ApiSpec'

export type MemoryType = PresetMemoryType | (string & {})

export interface MemoryNodeData {
  id: string
  title: string
  type: MemoryType
  summary: string
  content: string
  confidence: number
  tags: string[]
  sourceMeta?: {
    platform?: string
    extractedAt?: number
    sourceExcerpt?: string
    /** 证据锚定：抽取自会话的原句引用（P1 质量管线） */
    evidenceQuotes?: string[]
    /** 证据校验结果：通过数/总数（由管线写入，非 LLM 自报） */
    evidenceVerified?: { passed: number, total: number }
    // Rubric v2 评估沉淀溯源
    sessionId?: string
    sessionTitle?: string
    score?: number
    grade?: string
    category?: string
    evaluatorVersion?: number
    extra?: Record<string, unknown>
  }
  createdAt: number
  updatedAt: number
  /** P2 状态分层：draft（低置信/证据存疑，不进召回）| confirmed（默认，含存量） */
  status?: 'confirmed' | 'draft'
}

export interface ProjectEntity {
  name: string
  cwd: string
}

export interface TechConceptEntity {
  name: string
  category?: string // 'framework' | 'library' | 'language' | 'tool' | 'db' | 'infra' | 'other'
}

export interface ProblemEntity {
  title: string
  symptom?: string
  errorCode?: string
}

export interface PatternSnippetEntity {
  title?: string
  code: string
  language?: string
  rules?: string
}

export interface MemoryGraphItem extends MemoryNodeData {
  projects: ProjectEntity[]
  techConcepts: TechConceptEntity[]
  problems: ProblemEntity[]
  snippets: PatternSnippetEntity[]
  supersededIds?: string[]
}

/**
 * 召回场景的轻量返回项（L0/L1 级）：不含 content / snippets 等大字段。
 * 语义：recall = 发现，详情用 getMemory(id) 拉取完整 MemoryGraphItem。
 */
export interface MemoryRecallItem {
  id: string
  title: string
  type: string
  summary: string
  confidence: number
  tags: string[]
  updatedAt: number
  projects: ProjectEntity[]
  techConcepts: TechConceptEntity[]
  problems: { title: string }[]
}

export interface MemoryExtractInput {
  sessionTitle?: string
  /** 会话溯源（写入 sourceMeta，并作为统一去重的同源会话键） */
  sessionId?: string
  cwd?: string
  platform?: string
  messagesContent: string
  userInstructions?: string
  /** 抽取引导（注入到 system prompt 的定向约束：评估分类引导 / 用户自由指引） */
  guidance?: string
}

export interface MemoryGraphQueryOptions {
  type?: string
  project?: string
  cwd?: string
  tech?: string
  search?: string
  limit?: number
  offset?: number
}

export interface GraphVisualizationData {
  nodes: Array<{
    id: string
    label: string
    name: string
    type?: string
    color?: string
    data: Record<string, unknown>
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    label: string
    type: string
  }>
}
