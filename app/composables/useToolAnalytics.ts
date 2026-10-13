import type { SessionMessage } from '../../server/utils/types'
import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'

export interface SelectedToolCall {
  index: number
  timestamp?: number
  name: string
  arguments: unknown
  summary: string
  associatedThought?: string
}

/**
 * 会话详情页的工具/技能分析：调用次数统计、技能识别、单工具调用明细弹窗。
 */
export function useToolAnalytics(messagesRef: MaybeRefOrGetter<SessionMessage[]>) {
  const isToolModalOpen = ref(false)
  const selectedToolName = ref('')
  const selectedToolCalls = ref<SelectedToolCall[]>([])

  const normalizeToolName = (tool: { name?: string, type?: string }) =>
    (tool.name || tool.type || 'unknown_tool')
      .replace(/^default_api:/, '')
      .replace(/^mcp__.*?__/, '')

  const openToolDetails = (toolName: string) => {
    selectedToolName.value = toolName
    const calls: SelectedToolCall[] = []
    const messages = toValue(messagesRef)

    let callIndex = 1
    for (const msg of messages) {
      if (msg.toolCalls && msg.toolCalls.length) {
        for (const tool of msg.toolCalls) {
          const name = normalizeToolName(tool)

          if (name === toolName) {
            const rawArgs: unknown = tool.arguments || tool.args || tool.input || {}
            let parsedArgs: unknown = rawArgs
            if (typeof rawArgs === 'string') {
              try {
                parsedArgs = JSON.parse(rawArgs)
              } catch {
                parsedArgs = rawArgs
              }
            }

            const argsRecord = parsedArgs as Record<string, unknown>

            // Extract quick summary
            let summary: string
            if (argsRecord.CommandLine) {
              summary = argsRecord.CommandLine as string
            } else if (argsRecord.AbsolutePath || argsRecord.TargetFile || argsRecord.SearchDirectory || argsRecord.SearchPath) {
              summary = (argsRecord.AbsolutePath || argsRecord.TargetFile || argsRecord.SearchDirectory || argsRecord.SearchPath) as string
            } else if (argsRecord.Query || argsRecord.Pattern || argsRecord.query) {
              summary = `Query: "${(argsRecord.Query || argsRecord.Pattern || argsRecord.query) as string}"`
            } else if (argsRecord.Prompt || argsRecord.prompt) {
              summary = (argsRecord.Prompt || argsRecord.prompt) as string
            } else if (argsRecord.Url || argsRecord.url) {
              summary = (argsRecord.Url || argsRecord.url) as string
            } else {
              summary = typeof parsedArgs === 'object' ? Object.keys(argsRecord).join(', ') : String(parsedArgs)
            }

            calls.push({
              index: callIndex++,
              timestamp: msg.timestamp,
              name,
              arguments: parsedArgs,
              summary,
              associatedThought: msg.thought
            })
          }
        }
      }
    }

    selectedToolCalls.value = calls
    isToolModalOpen.value = true
  }

  const toolStats = computed(() => {
    const counts: Record<string, number> = {}
    const skillSet = new Set<string>()
    const messages = toValue(messagesRef)

    for (const msg of messages) {
      if (msg.toolCalls && msg.toolCalls.length) {
        for (const tool of msg.toolCalls) {
          const name = normalizeToolName(tool)
          counts[name] = (counts[name] || 0) + 1

          // Detect Skill invocation
          const argsStr = typeof tool.arguments === 'string'
            ? tool.arguments
            : JSON.stringify(tool.arguments || tool.args || tool.input || {})
          if (name === 'view_file' || name === 'read_file') {
            const match = argsStr.match(/skills\/([^/]+)\/SKILL\.md/i) || argsStr.match(/skills\/([^/"'\\]+)/i)
            if (match && match[1]) {
              skillSet.add(match[1])
            }
          } else if (name.toLowerCase().includes('skill')) {
            skillSet.add(name)
          }
        }
      }

      // Also check text or thought mentions of skills
      if (msg.thought) {
        const skillMatches = msg.thought.matchAll(/skill:\s*([a-zA-Z0-9_-]+)/gi)
        for (const m of skillMatches) {
          if (m[1]) skillSet.add(m[1])
        }
      }
    }

    const sortedTools = Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    const totalToolCalls = sortedTools.reduce((sum, item) => sum + item.count, 0)

    return {
      totalToolCalls,
      uniqueToolCount: sortedTools.length,
      tools: sortedTools,
      skills: Array.from(skillSet)
    }
  })

  return {
    isToolModalOpen,
    selectedToolName,
    selectedToolCalls,
    openToolDetails,
    toolStats
  }
}
