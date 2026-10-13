import { mcpLogger } from '../../mcp-logger'
import { memoryService } from '../../memory-service'

import type { McpToolDefinition } from '../tool-types'

export const SearchMemoryGraphTool: McpToolDefinition = {
  name: 'search_memory_graph',
  description: '获取 Grafeo 知识图谱的拓扑实体关系网络（包含 Memory、Project、TechConcept、Problem 节点及关联边）',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: '可选的记忆类型筛选'
      },
      project: {
        type: 'string',
        description: '可选的项目名称筛选'
      },
      limit: {
        type: 'number',
        description: '最大节点返回数'
      }
    }
  },
  async handler({ args, name, startTime }) {
    const type = (args.type as string) || undefined
    const project = (args.project as string) || undefined
    const limit = typeof args.limit === 'number' ? args.limit : 200

    const graph = await memoryService.getGraphData({ type, project, limit })

    mcpLogger.addLog({
      type: 'tool',
      name,
      params: args,
      status: 'success',
      durationMs: Date.now() - startTime,
      responsePreview: `Fetched graph with ${graph.nodes.length} nodes and ${graph.edges.length} edges`
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(graph, null, 2)
        }
      ]
    }
  }
}
