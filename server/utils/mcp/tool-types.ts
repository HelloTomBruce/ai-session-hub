import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/** 支持平台全集（工具 schema 的 enum 与分发描述共用） */
export const ALL_PLATFORMS: string[] = [
  'all', 'pi', 'opencode', 'agy', 'claude', 'codex', 'workbuddy',
  'reasonix', 'kimi', 'trae', 'cursor', 'mimo', 'zcode', 'dsh'
]

export type McpToolResult = CallToolResult

/**
 * 工具执行上下文：args/name/startTime 与主分发器透传的原始字段一致，
 * 各工具 handler 沿用旧的分发函数体（mcpLogger 调用保持原样）。
 */
export interface McpToolContext {
  args: Record<string, unknown>
  name: string
  startTime: number
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /**
   * 声明工具输出包含会话原文/LLM 生成的不可信内容：分发层会将其文本输出
   * 包进随机 tag 围栏（data-fence.ts），防存储文本中的提示词注入。
   */
  wrapsUntrusted?: boolean
  handler: (ctx: McpToolContext) => Promise<McpToolResult>
}
