import { adapterRegistry } from '../../adapter-registry'
import { mcpLogger } from '../../mcp-logger'

import type { McpToolDefinition } from '../tool-types'
import { ALL_PLATFORMS } from '../tool-types'

export const ListSessionsTool: McpToolDefinition = {
  name: 'list_sessions',
  description: '列出本地由 AI Session Hub 管理的所有 CLI 和 App 历史会话（支持按平台、工作区路径 CWD、关键词搜索和数量限制）',
  inputSchema: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        description: '筛选平台：all | pi | opencode | agy | claude | codex | workbuddy | reasonix | kimi | trae | cursor | mimo | zcode',
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
  },
  async handler({ args, name, startTime }) {
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
}
