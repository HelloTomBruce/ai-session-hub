import { adapterRegistry } from '../../adapter-registry'
import { mcpLogger } from '../../mcp-logger'
import { evaluateSessionValue } from '@session-hub/analyzer'
import type { PlatformType } from '../../types'

import type { McpToolDefinition } from '../tool-types'

export const EvaluateSessionValueTool: McpToolDefinition = {
  name: 'evaluate_session_value',
  description: '对指定会话调用多维价值量化评估引擎 (ValueScoringEngine)，输出客观价值分、证据归因与入库建议',
  inputSchema: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        description: '会话所在平台 (pi, opencode, agy, claude, codex, workbuddy, reasonix, kimi, trae, cursor, mimo, zcode)'
      },
      sessionId: {
        type: 'string',
        description: '会话唯一标识 ID'
      }
    },
    required: ['platform', 'sessionId']
  },
  async handler({ args, name, startTime }) {
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
}
