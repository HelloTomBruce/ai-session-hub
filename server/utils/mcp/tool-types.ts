import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { PlatformType } from '../types'

/** 支持平台全集（工具 schema 的 enum 与分发描述共用） */
export const ALL_PLATFORMS: string[] = [
  'all', 'pi', 'opencode', 'agy', 'claude', 'codex', 'workbuddy',
  'reasonix', 'kimi', 'trae', 'cursor', 'mimo', 'zcode'
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
  handler: (ctx: McpToolContext) => Promise<McpToolResult>
}

export type { PlatformType }
