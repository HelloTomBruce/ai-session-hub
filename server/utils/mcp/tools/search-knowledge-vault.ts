import { mcpLogger } from '../../mcp-logger'
import { knowledgeService } from '../../knowledge-service'

import type { McpToolDefinition } from '../tool-types'

export const SearchKnowledgeVaultTool: McpToolDefinition = {
  name: 'search_knowledge_vault',
  description: '检索 Session Hub 知识金库 (Knowledge Vault) 中的架构决策(ADR)、避坑经验(Gotcha)、设计模式(Pattern)与里程碑(Milestone)',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词（匹配标题、摘要、方案或标签）'
      },
      type: {
        type: 'string',
        description: '按知识类型筛选：all | adr | gotcha | pattern | milestone',
        enum: ['all', 'adr', 'gotcha', 'pattern', 'milestone']
      },
      tag: {
        type: 'string',
        description: '按标签筛选（如 nuxt, sqlite, auth 等）'
      },
      limit: {
        type: 'number',
        description: '返回最大条数（默认 10）'
      }
    }
  },
  async handler({ args, name, startTime }) {
    const query = (args.query as string) || ''
    const type = (args.type as string) || 'all'
    const tag = (args.tag as string) || ''
    const limit = Number(args.limit) || 10

    const { items } = knowledgeService.listItems({
      type: type === 'all' ? undefined : type,
      search: query || undefined,
      tag: tag || undefined,
      limit
    })

    mcpLogger.addLog({
      type: 'tool',
      name,
      params: args,
      status: 'success',
      durationMs: Date.now() - startTime,
      responsePreview: `Found ${items.length} knowledge items matching "${query || tag || type}"`
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(items, null, 2)
        }
      ]
    }
  }
}
