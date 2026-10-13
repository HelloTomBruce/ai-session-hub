import { adapterRegistry } from '../../adapter-registry'
import { mcpLogger } from '../../mcp-logger'
import { knowledgeHarvest } from '../../knowledge-harvest'
import type { PlatformType } from '../../types'

import type { McpToolDefinition } from '../tool-types'

export const CaptureSessionInsightTool: McpToolDefinition = {
  name: 'capture_session_insight',
  description: '直接向 Session Hub 记忆图谱（Grafeo）写入一条新的经验资产（ADR/Gotcha/Pattern/Milestone），按会话与标题自动去重、演进',
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
  },
  async handler({ args, name, startTime }) {
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

    // 关联会话信息（标题/工作区）；找不到时静默降级为无会话手工资产
    let sessionTitle: string | undefined
    let cwd: string | undefined
    if (sessionId) {
      const linkedSession = adapterRegistry.getSession(platform, sessionId)
      if (linkedSession) {
        sessionTitle = linkedSession.title
        cwd = linkedSession.cwd
      }
    }

    const result = await knowledgeHarvest.captureManual({
      title,
      type,
      summary,
      solution,
      tags,
      sessionId,
      platform,
      sessionTitle,
      cwd
    })

    if (result.status === 'candidate' || !result.item) {
      mcpLogger.addLog({
        type: 'tool',
        name,
        params: args,
        status: 'error',
        durationMs: Date.now() - startTime,
        error: result.reason || '沉淀失败'
      })
      return {
        content: [
          {
            type: 'text',
            text: `资产沉淀失败: ${result.reason || '内容为空'}`
          }
        ],
        isError: true
      }
    }

    mcpLogger.addLog({
      type: 'tool',
      name,
      params: args,
      status: 'success',
      durationMs: Date.now() - startTime,
      responsePreview: `Captured memory ${result.item.id} (${type}: ${title}, dedup=${result.dedup})`
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: '资产已沉淀至 Session Hub 记忆图谱（Grafeo）',
            dedup: result.dedup,
            item: result.item
          }, null, 2)
        }
      ]
    }
  }
}
