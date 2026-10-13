import { cacheService } from '../../cache-service'
import { mcpLogger } from '../../mcp-logger'

import type { McpToolDefinition } from '../tool-types'
import { ALL_PLATFORMS } from '../tool-types'

export const SearchSessionsFtsTool: McpToolDefinition = {
  name: 'search_sessions_fts',
  description: '对本地所有 12+ 个 AI 编码工具的历史会话正文、工具调用、代码修改文件与思考链进行全库全文检索（FTS5 + 中英文智能分词），快速找回历史上下文与报错解决记录',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词、问题描述、函数名、错误日志或修改的文件路径'
      },
      platform: {
        type: 'string',
        description: '可选平台过滤：all | pi | opencode | agy | claude | codex | workbuddy | reasonix | kimi | trae | cursor | mimo | zcode',
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
  },
  async handler({ args, name, startTime }) {
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
}
