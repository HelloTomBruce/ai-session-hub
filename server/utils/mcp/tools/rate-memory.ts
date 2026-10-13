import { recallStats } from '../../recall-stats'

import type { McpToolDefinition } from '../tool-types'

export const RateMemoryTool: McpToolDefinition = {
  name: 'rate_memory',
  description: '对召回/使用过的记忆给出反馈（P3 质量闭环）：有用则提升其后续召回排序权重，无用则降低。建议在 get_memory 消费完内容后按实际帮助程度调用。',
  inputSchema: {
    type: 'object',
    properties: {
      memory_id: {
        type: 'string',
        description: '记忆节点 id（来自 recall_memories / get_memory）'
      },
      useful: {
        type: 'boolean',
        description: 'true=有帮助（升权）；false=无帮助（降权）'
      }
    },
    required: ['memory_id', 'useful']
  },
  async handler({ args }) {
    const memoryId = (args.memory_id as string) || ''
    const useful = Boolean(args.useful)
    if (!memoryId) {
      throw new Error('memory_id is required')
    }
    recallStats.logFeedback(memoryId, useful)
    return {
      content: [{
        type: 'text' as const,
        text: `已记录反馈：${memoryId} → ${useful ? '有用 👍（提升召回排序权重）' : '无用 👎（降低排序权重）'}`
      }]
    }
  }
}
