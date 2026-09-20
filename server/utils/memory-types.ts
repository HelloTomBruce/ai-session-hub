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
    extra?: Record<string, unknown>
  }
  createdAt: number
  updatedAt: number
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

export interface MemoryExtractInput {
  sessionTitle?: string
  cwd?: string
  platform?: string
  messagesContent: string
  userInstructions?: string
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
