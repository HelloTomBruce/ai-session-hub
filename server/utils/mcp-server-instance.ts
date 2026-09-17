import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { adapterRegistry } from './adapter-registry'
import { distillSessionsContent } from './distillator'
import { mcpLogger } from './mcp-logger'
import { knowledgeService } from './knowledge-service'
import { evaluateSessionValue } from './evaluator-engine'
import { cacheService } from './cache-service'
import type { PlatformType } from './types'

const ALL_PLATFORMS = ['all', 'pi', 'opencode', 'agy', 'claude', 'codex', 'workbuddy', 'reasonix', 'kimi', 'trae', 'cursor', 'mimo']

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

  // 1. Tools Definition
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'search_sessions_fts',
          description: '对本地所有 11+ 个 AI 编码工具的历史会话正文、工具调用、代码修改文件与思考链进行全库全文检索（FTS5 + 中英文智能分词），快速找回历史上下文与报错解决记录',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: '搜索关键词、问题描述、函数名、错误日志或修改的文件路径'
              },
              platform: {
                type: 'string',
                description: '可选平台过滤：all | pi | opencode | agy | claude | codex | workbuddy | reasonix | kimi | trae | cursor | mimo',
                enum: ALL_PLATFORMS
              },
              role: {
                type: 'string',
                description: '按消息角色过滤：all | user | assistant',
                enum: ['all', 'user', 'assistant']
              },
              cwd: {
                type: 'string',
                description: '可选工作区项目路径关键词或前缀过滤'
              },
              limit: {
                type: 'number',
                description: '返回命中会话的最大数量（默认 10）'
              }
            },
            required: ['query']
          }
        },
        {
          name: 'list_sessions',
          description: '列出本地由 AI Session Hub 管理的所有 CLI 和 App 历史会话（支持按平台、工作区路径 CWD、关键词搜索和数量限制）',
          inputSchema: {
            type: 'object',
            properties: {
              platform: {
                type: 'string',
                description: '筛选平台：all | pi | opencode | agy | claude | codex | workbuddy | reasonix | kimi | trae | cursor | mimo',
                enum: ALL_PLATFORMS
              },
              cwd: {
                type: 'string',
                description: '按工作目录关键词或路径筛选（如 /Users/zhangbei/code/session-hub）'
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
                description: '会话所在平台 (pi, opencode, agy, claude, codex, workbuddy, reasonix, kimi, trae, cursor, mimo)'
              },
              sessionId: {
                type: 'string',
                description: '会话唯一标识 ID'
              }
            },
            required: ['platform', 'sessionId']
          }
        },
        {
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
          }
        },
        {
          name: 'get_project_adrs',
          description: '获取指定工作区目录或全局所有的架构决策记录 (ADR)',
          inputSchema: {
            type: 'object',
            properties: {
              cwd: {
                type: 'string',
                description: '工作区路径关键词或前缀（可选）'
              }
            }
          }
        },
        {
          name: 'capture_session_insight',
          description: '直接向 Session Hub 知识金库写入一条新的经验资产（ADR/Gotcha/Pattern/Milestone）',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: '资产标题'
              },
              type: {
                type: 'string',
                description: '资产类型',
                enum: ['adr', 'gotcha', 'pattern', 'milestone']
              },
              summary: {
                type: 'string',
                description: '核心摘要与背景说明'
              },
              solution: {
                type: 'string',
                description: '解决方案/决策细节/规避指南'
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: '关联标签'
              },
              sessionId: {
                type: 'string',
                description: '关联的会话 ID（可选）'
              },
              platform: {
                type: 'string',
                description: '关联的平台名称（可选）'
              }
            },
            required: ['title', 'type', 'summary', 'solution']
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
          name: 'evaluate_session_value',
          description: '对指定会话调用多维价值量化评估引擎 (ValueScoringEngine)，输出客观价值分、证据归因与入库建议',
          inputSchema: {
            type: 'object',
            properties: {
              platform: {
                type: 'string',
                description: '会话所在平台 (pi, opencode, agy, claude, codex, workbuddy, reasonix, kimi, trae, cursor, mimo)'
              },
              sessionId: {
                type: 'string',
                description: '会话唯一标识 ID'
              }
            },
            required: ['platform', 'sessionId']
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
    const startTime = Date.now()

    try {
      if (name === 'search_sessions_fts') {
        const query = (args.query as string) || ''
        const platform = (args.platform as string) || 'all'
        const role = (args.role as string) || 'all'
        const cwd = (args.cwd as string) || ''
        const limit = Number(args.limit) || 10

        const res = cacheService.search(query, {
          platform: platform === 'all' ? undefined : platform,
          role: role === 'all' ? undefined : role,
          cwd: cwd || undefined,
          limit,
          groupBy: 'session'
        })

        const results = (res.groupedSessions || []).map(s => ({
          sessionId: s.session_id,
          platform: s.platform,
          title: s.title,
          cwd: s.cwd,
          tags: s.tags,
          updatedAt: new Date(s.updated_at).toISOString(),
          matchedCount: s.matchedCount,
          snippets: s.snippets.map(sn => ({
            role: sn.role,
            snippet: sn.snippet.replace(/<\/?mark>/g, '**')
          }))
        }))

        const resText = JSON.stringify({
          totalMatchedMessages: res.total,
          matchedSessionsCount: results.length,
          sessions: results
        }, null, 2)

        mcpLogger.addLog({
          type: 'tool',
          name,
          params: args,
          status: 'success',
          durationMs: Date.now() - startTime,
          responsePreview: `FTS query "${query}" matched ${res.total} messages in ${results.length} sessions`
        })

        return {
          content: [
            {
              type: 'text',
              text: resText
            }
          ]
        }
      }

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
            s.title.toLowerCase().includes(search)
            || s.id.toLowerCase().includes(search)
            || s.cwd.toLowerCase().includes(search)
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

        const resText = JSON.stringify(results, null, 2)
        mcpLogger.addLog({
          type: 'tool',
          name,
          params: args,
          status: 'success',
          durationMs: Date.now() - startTime,
          responsePreview: `Found ${results.length} sessions`
        })

        return {
          content: [
            {
              type: 'text',
              text: resText
            }
          ]
        }
      }

      if (name === 'get_session_details') {
        const platform = args.platform as PlatformType
        const sessionId = args.sessionId as string

        const res = adapterRegistry.getMessages(platform, sessionId)
        if (!res.session) {
          mcpLogger.addLog({
            type: 'tool',
            name,
            params: args,
            status: 'error',
            durationMs: Date.now() - startTime,
            error: `Session not found: ${sessionId}`
          })
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

        const resText = JSON.stringify({
          session: res.session,
          messages: res.messages
        }, null, 2)

        mcpLogger.addLog({
          type: 'tool',
          name,
          params: args,
          status: 'success',
          durationMs: Date.now() - startTime,
          responsePreview: `Loaded ${res.messages.length} messages for ${res.session.title}`
        })

        return {
          content: [
            {
              type: 'text',
              text: resText
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
        const report = await distillSessionsContent(fullData, provider)

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

      if (name === 'get_hub_stats') {
        const stats = adapterRegistry.getStats()
        mcpLogger.addLog({
          type: 'tool',
          name,
          params: args,
          status: 'success',
          durationMs: Date.now() - startTime,
          responsePreview: `Total ${stats.total} sessions across platforms`
        })
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(stats, null, 2)
            }
          ]
        }
      }

      if (name === 'search_knowledge_vault') {
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

      if (name === 'get_project_adrs') {
        const cwd = ((args.cwd as string) || '').toLowerCase().trim()
        let { items } = knowledgeService.listItems({ type: 'adr', limit: 100 })

        if (cwd) {
          items = items.filter((i) => {
            if (!i.sessionId) return true
            const session = adapterRegistry.getSession(i.platform || '', i.sessionId)
            return !session || session.cwd.toLowerCase().includes(cwd)
          })
        }

        mcpLogger.addLog({
          type: 'tool',
          name,
          params: args,
          status: 'success',
          durationMs: Date.now() - startTime,
          responsePreview: `Returned ${items.length} ADR items`
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

      if (name === 'capture_session_insight') {
        const title = (args.title as string) || '未命名资产'
        const rawType = ((args.type as string) || 'gotcha').toLowerCase()
        const typeMap: Record<string, 'ADR' | 'Gotcha' | 'Pattern' | 'Milestone'> = {
          adr: 'ADR',
          gotcha: 'Gotcha',
          pattern: 'Pattern',
          milestone: 'Milestone'
        }
        const type = typeMap[rawType] || 'Gotcha'
        const summary = (args.summary as string) || ''
        const solution = (args.solution as string) || ''
        const tags = (args.tags as string[]) || []
        const sessionId = (args.sessionId as string) || undefined
        const platform = (args.platform as PlatformType) || 'pi'

        const item = knowledgeService.saveItem({
          sessionId,
          platform,
          type,
          title,
          context: summary,
          decision: solution,
          tags
        })

        mcpLogger.addLog({
          type: 'tool',
          name,
          params: args,
          status: 'success',
          durationMs: Date.now() - startTime,
          responsePreview: `Saved knowledge ${item.id} (${type}: ${title})`
        })

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: '资产成功沉淀至 Session Hub Knowledge Vault',
                item
              }, null, 2)
            }
          ]
        }
      }

      if (name === 'evaluate_session_value') {
        const platform = args.platform as PlatformType
        const sessionId = args.sessionId as string

        const { session, messages } = adapterRegistry.getMessages(platform, sessionId)
        if (!session) {
          mcpLogger.addLog({
            type: 'tool',
            name,
            params: args,
            status: 'error',
            durationMs: Date.now() - startTime,
            error: `Session not found: ${sessionId}`
          })
          return {
            content: [
              {
                type: 'text',
                text: `会话未找到: platform=${platform}, sessionId=${sessionId}`
              }
            ],
            isError: true
          }
        }

        const evaluation = await evaluateSessionValue({
          sessionId,
          platform,
          title: session.title,
          cwd: session.cwd,
          messages: messages.map(m => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''),
            thought: m.thought,
            toolCalls: m.toolCalls
          }))
        })

        mcpLogger.addLog({
          type: 'tool',
          name,
          params: args,
          status: 'success',
          durationMs: Date.now() - startTime,
          responsePreview: `Evaluated score=${evaluation.overallScore} (${evaluation.grade})`
        })

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(evaluation, null, 2)
            }
          ]
        }
      }

      throw new Error(`未知的 MCP 工具: ${name}`)
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
    const stats = adapterRegistry.getStats()
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
