import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { adapterRegistry } from './adapter-registry'
import { mcpLogger } from './mcp-logger'
import { knowledgeService } from './knowledge-service'
import { mcpTools } from './mcp/tools'

export function createMcpServer() {
  const server = new Server(
    {
      name: 'ai-session-hub-mcp',
      version: '1.1.0'
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  )

  // 1. Tools Definition：schema 与 handler 收敛在各工具文件中，此处仅聚合
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: mcpTools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
    }
  })

  // 2. Tools Call Implementation：registry 分发，未知名保持旧行为（抛错由外层兜底）
  const toolMap = new Map(mcpTools.map(t => [t.name, t]))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params
    const startTime = Date.now()

    try {
      const tool = toolMap.get(name)
      if (!tool) {
        throw new Error(`未知的 MCP 工具: ${name}`)
      }
      return await tool.handler({ args, name, startTime })
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      mcpLogger.addLog({
        type: 'tool',
        name,
        params: args,
        status: 'error',
        durationMs: Date.now() - startTime,
        error: errMsg
      })

      return {
        content: [
          {
            type: 'text',
            text: `执行失败: ${errMsg}`
          }
        ],
        isError: true
      }
    }
  })

  // 3. Resources Definition
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'session-hub://stats',
          name: 'AI Session Hub 统计信息',
          description: '当前各 AI 客户端会话总数与平台状态摘要',
          mimeType: 'application/json'
        },
        {
          uri: 'session-hub://adrs/latest',
          name: '最新架构决策记录 (ADR)',
          description: '从开发会话中沉淀出的最新技术决策',
          mimeType: 'application/json'
        }
      ]
    }
  })

  // 4. Resources Read Implementation
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params
    const startTime = Date.now()

    try {
      if (uri === 'session-hub://stats') {
        const stats = adapterRegistry.getStats()
        mcpLogger.addLog({
          type: 'resource',
          name: uri,
          status: 'success',
          durationMs: Date.now() - startTime,
          responsePreview: `Returned stats resource`
        })

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(stats, null, 2)
            }
          ]
        }
      }

      if (uri === 'session-hub://adrs/latest') {
        const { items } = knowledgeService.listItems({ type: 'adr', limit: 20 })
        mcpLogger.addLog({
          type: 'resource',
          name: uri,
          status: 'success',
          durationMs: Date.now() - startTime,
          responsePreview: `Returned ${items.length} ADRs`
        })

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(items, null, 2)
            }
          ]
        }
      }

      throw new Error(`未知资源 URI: ${uri}`)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      mcpLogger.addLog({
        type: 'resource',
        name: uri,
        status: 'error',
        durationMs: Date.now() - startTime,
        error: errMsg
      })

      throw err
    }
  })

  return server
}
