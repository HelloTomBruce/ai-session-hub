import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { adapterRegistry } from './adapter-registry'
import { distillSessionsContent } from './distillator'
import type { PlatformType } from './types'

export function createMcpServer() {
  const server = new Server(
    {
      name: 'ai-session-hub-mcp',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  )

  // 1. Tools Definition
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_sessions',
          description: '列出本地由 AI Session Hub 管理的所有 CLI 和 App 历史会话（支持按平台、工作区路径 CWD、关键词搜索和数量限制）',
          inputSchema: {
            type: 'object',
            properties: {
              platform: {
                type: 'string',
                description: '筛选平台：all | pi | opencode | agy | claude | codex | workbuddy | reasonix',
                enum: ['all', 'pi', 'opencode', 'agy', 'claude', 'codex', 'workbuddy', 'reasonix']
              },
              cwd: {
                type: 'string',
                description: '按工作目录关键词或路径筛选（如 /Users/zhangbei/code/dataease-web）'
              },
              search: {
                type: 'string',
                description: '搜索标题或元数据关键词'
              },
              limit: {
                type: 'number',
                description: '返回会话的最大数量（默认 20）'
              }
            }
          }
        },
        {
          name: 'get_session_details',
          description: '获取指定会话的完整对话历史记录、思考链路（Thinking）与工具调用数据',
          inputSchema: {
            type: 'object',
            properties: {
              platform: {
                type: 'string',
                description: '会话所在平台 (pi, opencode, agy, claude, codex, workbuddy, reasonix)',
                required: true
              },
              sessionId: {
                type: 'string',
                description: '会话唯一标识 ID',
                required: true
              }
            },
            required: ['platform', 'sessionId']
          }
        },
        {
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
          }
        },
        {
          name: 'get_hub_stats',
          description: '获取本地各 AI 工具与 App 的会话统计数据（各工具会话总数、活跃状态等）',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        }
      ]
    }
  })

  // 2. Tools Call Implementation
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params

    if (name === 'list_sessions') {
      const platform = (args.platform as string) || 'all'
      const search = ((args.search as string) || '').toLowerCase().trim()
      const cwd = ((args.cwd as string) || '').toLowerCase().trim()
      const limit = Number(args.limit) || 20

      let sessions = adapterRegistry.getAllSessions(platform)

      if (cwd) {
        sessions = sessions.filter(s => s.cwd.toLowerCase().includes(cwd))
      }
      if (search) {
        sessions = sessions.filter(s => 
          s.title.toLowerCase().includes(search) || 
          s.id.toLowerCase().includes(search) ||
          s.cwd.toLowerCase().includes(search)
        )
      }

      const results = sessions.slice(0, limit).map(s => ({
        id: s.id,
        platform: s.cli,
        title: s.title,
        cwd: s.cwd,
        model: s.model,
        messageCount: s.messageCount,
        updatedAt: new Date(s.updatedAt).toISOString()
      }))

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2)
          }
        ]
      }
    }

    if (name === 'get_session_details') {
      const platform = args.platform as PlatformType
      const sessionId = args.sessionId as string

      const res = adapterRegistry.getMessages(platform, sessionId)
      if (!res.session) {
        return {
          content: [
            {
              type: 'text',
              text: `未找到指定会话: platform=${platform}, sessionId=${sessionId}`
            }
          ],
          isError: true
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              session: res.session,
              messages: res.messages
            }, null, 2)
          }
        ]
      }
    }

    if (name === 'distill_knowledge') {
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
        return {
          content: [
            {
              type: 'text',
              text: '没有找到可供提炼总结的匹配会话。'
            }
          ]
        }
      }

      // Fetch messages for each session
      const fullData = targetSessions.map(s => {
        const { messages } = adapterRegistry.getMessages(s.cli, s.id)
        return { session: s, messages }
      })

      const report = distillSessionsContent(fullData)

      return {
        content: [
          {
            type: 'text',
            text: report.rawMarkdown
          }
        ]
      }
    }

    if (name === 'get_hub_stats') {
      const stats = adapterRegistry.getStats()
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(stats, null, 2)
          }
        ]
      }
    }

    throw new Error(`Unknown tool: ${name}`)
  })

  // 3. Resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const sessions = adapterRegistry.getAllSessions().slice(0, 30)
    return {
      resources: sessions.map(s => ({
        uri: `session://${s.cli}/${s.id}`,
        name: `[${s.cli.toUpperCase()}] ${s.title}`,
        description: `Session at ${s.cwd}`,
        mimeType: 'application/json'
      }))
    }
  })

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri
    const match = uri.match(/^session:\/\/([^/]+)\/(.+)$/)
    if (!match) {
      throw new Error(`Invalid resource URI: ${uri}`)
    }

    const platform = match[1] as PlatformType
    const sessionId = match[2]
    const res = adapterRegistry.getMessages(platform, sessionId)

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(res, null, 2)
        }
      ]
    }
  })

  return server
}
