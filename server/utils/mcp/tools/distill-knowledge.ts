import { adapterRegistry } from '../../adapter-registry'
import { mcpLogger } from '../../mcp-logger'
import { getLLMProviderSettings } from '../../llm-provider-config'
import { distillSessionsContent } from '@session-hub/analyzer'
import { fileSummaryStore } from '../../distill-cache'

import type { McpToolDefinition } from '../tool-types'

export const DistillKnowledgeTool: McpToolDefinition = {
  name: 'distill_knowledge',
  description: '对指定的一个或多个会话进行知识提炼、行动轨迹复盘、技术选型决策与经验避坑要点提炼，生成结构化知识总结报告',
  inputSchema: {
    type: 'object',
    properties: {
      sessionIds: {
        type: 'array',
        items: { type: 'string' },
        description: '要总结提炼的会话 ID 列表'
      },
      platform: {
        type: 'string',
        description: '指定平台（若不指定 sessionIds，则提炼该平台近期的会话）'
      },
      cwd: {
        type: 'string',
        description: '按工作目录路径聚合提炼最近所有的开发会话'
      },
      limit: {
        type: 'number',
        description: '最多提取的会话数量（默认 5）'
      }
    }
  },
  async handler({ args, name, startTime }) {
    const sessionIds = (args.sessionIds as string[]) || []
    const platform = (args.platform as string) || 'all'
    const cwd = ((args.cwd as string) || '').toLowerCase().trim()
    const limit = Number(args.limit) || 5

    let targetSessions = adapterRegistry.getAllSessions(platform)

    if (sessionIds.length > 0) {
      targetSessions = targetSessions.filter(s => sessionIds.includes(s.id))
    } else if (cwd) {
      targetSessions = targetSessions.filter(s => s.cwd.toLowerCase().includes(cwd))
    }
    targetSessions = targetSessions.slice(0, limit)

    if (targetSessions.length === 0) {
      mcpLogger.addLog({
        type: 'tool',
        name,
        params: args,
        status: 'success',
        durationMs: Date.now() - startTime,
        responsePreview: 'No matching sessions for distillation'
      })
      return {
        content: [
          {
            type: 'text',
            text: '没有找到可供提炼总结的匹配会话。'
          }
        ]
      }
    }

    const fullData = targetSessions.map((s) => {
      const { messages } = adapterRegistry.getMessages(s.cli, s.id)
      return { session: s, messages }
    })

    const provider = getLLMProviderSettings()
    const report = await distillSessionsContent(fullData, provider, fileSummaryStore)

    mcpLogger.addLog({
      type: 'tool',
      name,
      params: args,
      status: 'success',
      durationMs: Date.now() - startTime,
      responsePreview: `Distilled ${targetSessions.length} sessions: ${report.actionsDone.length} actions, ${report.keyLearnings.length} learnings`
    })

    return {
      content: [
        {
          type: 'text',
          text: report.rawMarkdown
        }
      ]
    }
  }
}
