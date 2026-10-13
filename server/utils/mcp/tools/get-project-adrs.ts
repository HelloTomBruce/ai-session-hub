import { adapterRegistry } from '../../adapter-registry'
import { mcpLogger } from '../../mcp-logger'
import { knowledgeService } from '../../knowledge-service'

import type { McpToolDefinition } from '../tool-types'

export const GetProjectAdrsTool: McpToolDefinition = {
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
  },
  async handler({ args, name, startTime }) {
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
}
