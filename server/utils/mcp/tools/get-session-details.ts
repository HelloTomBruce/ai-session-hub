import { adapterRegistry } from '../../adapter-registry'
import { mcpLogger } from '../../mcp-logger'
import type { PlatformType } from '../../types'

import type { McpToolDefinition } from '../tool-types'

export const GetSessionDetailsTool: McpToolDefinition = {
  name: 'get_session_details',
  description: '获取指定会话的完整对话历史记录、思考链路（Thinking）与工具调用数据',
  inputSchema: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        description: '会话所在平台 (pi, opencode, agy, claude, codex, workbuddy, reasonix, kimi, trae, cursor, mimo, zcode, dsh)'
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
}
