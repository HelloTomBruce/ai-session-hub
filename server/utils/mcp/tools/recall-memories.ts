import { mcpLogger } from '../../mcp-logger'
import { memoryService } from '../../memory-service'

import type { McpToolDefinition } from '../tool-types'

export const RecallMemoriesTool: McpToolDefinition = {
  name: 'recall_memories',
  description: '从基于 Grafeo 图数据库的本地记忆库中，按工作区路径、涉及的技术栈、关键词或记忆分类召回相关经验、避坑指南 (Gotchas) 与架构决策 (ADRs)。返回摘要级信息（id/title/summary/置信度/实体标签，不含正文与代码片段）；需要完整内容时用 get_memory 按 id 拉取。',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索问题、关键词、痛点或方案描述'
      },
      cwd: {
        type: 'string',
        description: '当前项目或工作区路径（用于优先召回当前项目沉淀的经验）'
      },
      tech: {
        type: 'array',
        items: { type: 'string' },
        description: '当前使用或相关的技术栈实体列表（如 ["Nuxt", "Grafeo", "SQLite"]）'
      },
      type: {
        type: 'string',
        description: '记忆类型过滤：ADR | Gotcha | BestPractice | Pattern | Workflow | Config 或自定义类型'
      },
      limit: {
        type: 'number',
        description: '最大返回条数（默认 10）'
      }
    }
  },
  async handler({ args, name, startTime }) {
    const query = (args.query as string) || ''
    const cwd = (args.cwd as string) || ''
    const tech = (args.tech as string[]) || []
    const type = (args.type as string) || undefined
    const limit = typeof args.limit === 'number' ? args.limit : 10

    const memories = await memoryService.recallMemories({
      query,
      cwd,
      tech,
      type,
      limit
    })

    mcpLogger.addLog({
      type: 'tool',
      name,
      params: args,
      status: 'success',
      durationMs: Date.now() - startTime,
      responsePreview: `Recalled ${memories.length} memories from Grafeo graph`
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: memories.length,
              memories,
              hint: '以上为摘要级信息；需要完整正文与代码片段时，用 get_memory 按对应 id 拉取。'
            },
            null,
            2
          )
        }
      ]
    }
  }
}
