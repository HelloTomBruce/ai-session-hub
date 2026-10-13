import type { SessionMessage } from '../../server/utils/types'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'

export interface ThinkingTimelineItem {
  type: 'intent' | 'thought' | 'tool' | 'conclusion'
  title: string
  detail?: string
  timestamp?: number
  badge?: string
  role: string
}

/**
 * 将消息流折叠为「意图 → 思维链 → 工具 → 结论」时间线。
 */
export function useThinkingTimeline(messagesRef: MaybeRefOrGetter<SessionMessage[]>) {
  return computed<ThinkingTimelineItem[]>(() => {
    const list: ThinkingTimelineItem[] = []

    for (const msg of toValue(messagesRef)) {
      if (msg.role === 'user') {
        list.push({
          type: 'intent',
          title: '用户提出意图 / 任务需求',
          detail: msg.content,
          timestamp: msg.timestamp,
          role: 'user'
        })
      } else if (msg.role === 'assistant') {
        if (msg.thought) {
          list.push({
            type: 'thought',
            title: '思维链推导与架构选型 (Thinking Rationale)',
            detail: msg.thought,
            timestamp: msg.timestamp,
            role: 'assistant'
          })
        }
        if (msg.toolCalls && msg.toolCalls.length) {
          for (const tool of msg.toolCalls) {
            const rawName = tool.name || tool.type || 'Tool'
            const name = rawName.replace(/^default_api:/, '')
            const args = typeof tool.arguments === 'string'
              ? tool.arguments
              : JSON.stringify(tool.arguments || tool.args || tool.input || {})
            list.push({
              type: 'tool',
              title: `工具调用: ${name}`,
              detail: args,
              badge: name,
              timestamp: msg.timestamp,
              role: 'tool'
            })
          }
        }
        if (msg.content && msg.content.trim()) {
          list.push({
            type: 'conclusion',
            title: '方案产出 / 答复反馈',
            detail: msg.content,
            timestamp: msg.timestamp,
            role: 'assistant'
          })
        }
      }
    }
    return list
  })
}
