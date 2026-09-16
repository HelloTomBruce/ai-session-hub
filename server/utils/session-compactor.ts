import type { SessionMessage, UnifiedSession } from './types'

export interface CompactedMessage {
  role: 'user' | 'assistant' | 'tool_summary'
  content: string
  thought?: string
}

export interface CompactedSession {
  id: string
  cli: string
  title: string
  cwd: string
  updatedAt: number
  messageCount: number
  transcriptText: string
}

/**
 * Compacts long session transcripts into an ultra-dense, noise-free representation
 * suitable for LLM context windows (preserving User Intention, Assistant Thought, Tool Actions without large file dumps).
 */
export function compactSessionForAI(session: UnifiedSession, messages: SessionMessage[]): CompactedSession {
  const compactedMessages: CompactedMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      // Keep full user intent
      compactedMessages.push({
        role: 'user',
        content: msg.content.trim()
      })
    } else if (msg.role === 'assistant') {
      let content = (msg.content || '').trim()

      // Extract brief tool summary if any
      const toolSummaries: string[] = []
      if (msg.toolCalls && msg.toolCalls.length) {
        for (const tool of msg.toolCalls) {
          const rawName = tool.name || tool.type || 'tool'
          const name = rawName.replace(/^default_api:/, '').replace(/^mcp__.*?__/, '')
          const rawArgs = typeof tool.arguments === 'string' ? safeParseJson(tool.arguments) : (tool.arguments || tool.args || tool.input || {})
          const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>

          let signature = `[Action: ${name}]`
          if (args.CommandLine) {
            signature += ` command="${String(args.CommandLine).slice(0, 120)}"`
          } else if (args.AbsolutePath || args.TargetFile || args.SearchDirectory || args.SearchPath) {
            const target = args.AbsolutePath || args.TargetFile || args.SearchDirectory || args.SearchPath
            signature += ` target="${String(target)}"`
          } else if (args.Query || args.Pattern || args.query) {
            signature += ` query="${args.Query || args.Pattern || args.query}"`
          }
          toolSummaries.push(signature)
        }
      }

      // Compact response text if overly repetitive
      if (content.length > 2000) {
        content = content.slice(0, 1000) + '\n... [略去中间详细代码] ...\n' + content.slice(-600)
      }

      if (toolSummaries.length > 0) {
        compactedMessages.push({
          role: 'tool_summary',
          content: toolSummaries.join('\n')
        })
      }

      if (content || msg.thought) {
        compactedMessages.push({
          role: 'assistant',
          content,
          thought: msg.thought ? msg.thought.trim() : undefined
        })
      }
    } else if (msg.role === 'tool') {
      // For standalone tool results, only record brief status/name if not covered
      const name = msg.name || 'tool'
      const brief = (msg.content || '').slice(0, 100).replace(/\n/g, ' ')
      compactedMessages.push({
        role: 'tool_summary',
        content: `[Tool Result: ${name}] -> ${brief}`
      })
    }
  }

  // Format into a clean plain text transcript
  const lines: string[] = [
    `=== SESSION [${session.cli.toUpperCase()}] "${session.title}" ===`,
    `CWD: ${session.cwd}`,
    `Updated: ${new Date(session.updatedAt).toLocaleString()}`,
    `--- TRANSCRIPT ---`
  ]

  for (const m of compactedMessages) {
    if (m.role === 'user') {
      lines.push(`\n[User]:\n${m.content}`)
    } else if (m.role === 'tool_summary') {
      lines.push(`\n[System/Tools]:\n${m.content}`)
    } else if (m.role === 'assistant') {
      if (m.thought) {
        lines.push(`\n[Assistant Thinking / Rationale]:\n${m.thought}`)
      }
      if (m.content) {
        lines.push(`\n[Assistant Answer]:\n${m.content}`)
      }
    }
  }

  return {
    id: session.id,
    cli: session.cli,
    title: session.title,
    cwd: session.cwd,
    updatedAt: session.updatedAt,
    messageCount: messages.length,
    transcriptText: lines.join('\n')
  }
}

function safeParseJson(str: string): unknown {
  try {
    return JSON.parse(str)
  } catch {
    return {}
  }
}
