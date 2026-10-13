import { adapterRegistry } from '../../adapter-registry'
import { mcpLogger } from '../../mcp-logger'

import type { McpToolDefinition } from '../tool-types'

export const GetHubStatsTool: McpToolDefinition = {
  name: 'get_hub_stats',
  description: '获取本地各 AI 工具与 App 的会话统计数据（各工具会话总数、活跃状态等）',
  inputSchema: {
    type: 'object',
    properties: {}
  },
  async handler({ args, name, startTime }) {
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
}
