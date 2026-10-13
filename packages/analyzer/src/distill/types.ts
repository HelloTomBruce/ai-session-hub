import type { UnifiedSession } from '@session-hub/core'

/**
 * Map 阶段单会话微摘要（蒸馏管线的中间产物）。
 */
export interface SingleSessionSummary {
  sessionId: string
  platform: string
  title: string
  cwd: string
  updatedAt: number
  actions: string[]
  decisions: Array<{
    title: string
    context: string
    decision: string
    consequence?: string
  }>
  learnings: string[]
  todos: string[]
  tools: string[]
}

/**
 * 蒸馏摘要存储契约（依赖注入，解耦宿主文件系统）。
 * 宿主实现文件缓存（~/.session-hub/cache/distill）；测试可注入内存实现。
 * 键语义：(platform, sessionId, updatedAt)——会话更新后缓存自动失效。
 */
export interface SummaryStore {
  get(platform: string, sessionId: string, updatedAt: number): SingleSessionSummary | null
  put(summary: SingleSessionSummary): void
}

/** 蒸馏管线输入条目：会话元数据 + 消息流 */
export type DistillInput = { session: UnifiedSession, messages: import('@session-hub/core').SessionMessage[] }
