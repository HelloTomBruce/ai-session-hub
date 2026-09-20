import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type {
  SessionPlugin,
  SessionPluginManifest,
  UnifiedSession,
  SessionMessage,
  SessionToolCall,
  CreateSessionPayload,
  UpdateSessionPayload
} from '@session-hub/core'

interface ClaudeMessageContentBlock {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: string | unknown
}

interface ClaudeJsonlMessage {
  id?: string
  role?: string
  model?: string
  content?: string | ClaudeMessageContentBlock[]
}

interface ClaudeJsonlLine {
  type?: string
  role?: string
  cwd?: string
  title?: string
  custom_title?: string
  aiTitle?: string
  message?: string | ClaudeJsonlMessage
  text?: string
  id?: string
  uuid?: string
  messageId?: string
  timestamp?: string
  updatedAt?: number
  tool_use?: unknown
  model?: string
}

export class ClaudePlugin implements SessionPlugin {
  readonly manifest: SessionPluginManifest = {
    id: 'claude',
    name: 'Claude Code',
    category: 'cli',
    icon: 'i-lucide-bot',
    version: '1.0.0',
    description: 'Anthropic 官方研究级 Coding CLI，支持项目级会话、MCP 与 Plugins',
    author: 'Session Hub Team',
    type: 'builtin',
    defaultEnabled: true
  }

  private baseDir: string
  /** 列表解析结果缓存：key 为文件路径，mtime 变化时失效（避免重复全量解析） */
  private sessionInfoCache = new Map<string, { mtimeMs: number, size: number, session: UnifiedSession }>()

  constructor(customBaseDir?: string) {
    this.baseDir = customBaseDir || path.join(os.homedir(), '.claude', 'projects')
  }

  isAvailable(): boolean {
    return fs.existsSync(this.baseDir)
  }

  private readJsonl<T>(filePath: string): T[] {
    try {
      if (!fs.existsSync(filePath)) return []
      const raw = fs.readFileSync(filePath, 'utf-8')
      const lines = raw.split('\n')
      const items: T[] = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          items.push(JSON.parse(trimmed) as T)
        } catch {
          // ignore corrupted line
        }
      }
      return items
    } catch (err) {
      console.error(`[ClaudePlugin] Failed to read ${filePath}:`, err)
      return []
    }
  }

  getSessions(): UnifiedSession[] {
    const sessions: UnifiedSession[] = []
    if (!this.isAvailable()) return sessions

    try {
      const projectDirs = fs.readdirSync(this.baseDir)
      for (const pDir of projectDirs) {
        const fullPDir = path.join(this.baseDir, pDir)
        if (!fs.statSync(fullPDir).isDirectory()) continue

        const files = fs.readdirSync(fullPDir)
        for (const file of files) {
          if (file.endsWith('.jsonl')) {
            const filePath = path.join(fullPDir, file)
            try {
              const stat = fs.statSync(filePath)

              // 缓存命中（mtime + size 未变）时直接复用上次解析结果
              const cached = this.sessionInfoCache.get(filePath)
              if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
                sessions.push(cached.session)
                continue
              }

              const id = file.replace('.jsonl', '')
              let title = ''
              let messageCount = 0
              let cwd = ''

              const lines = this.readJsonl<ClaudeJsonlLine>(filePath)
              for (const parsed of lines) {
                if (parsed.cwd && !cwd) cwd = parsed.cwd

                if (parsed.type === 'ai-title' && parsed.aiTitle) {
                  title = parsed.aiTitle
                } else if (parsed.type === 'custom_title' && parsed.title) {
                  title = parsed.title
                } else if (parsed.type === 'session_init' && (parsed.title || parsed.custom_title)) {
                  title = parsed.title || parsed.custom_title || ''
                } else {
                  const isUser = parsed.type === 'user' || parsed.role === 'user' || (typeof parsed.message === 'object' && parsed.message?.role === 'user')
                  const isAssistant = parsed.type === 'assistant' || parsed.role === 'assistant' || (typeof parsed.message === 'object' && parsed.message?.role === 'assistant')

                  if (isUser || isAssistant) {
                    messageCount++
                    if (isUser && !title) {
                      const rawMsg = parsed.message
                      if (typeof rawMsg === 'string') {
                        title = rawMsg.slice(0, 100).replace(/\n/g, ' ')
                      } else if (typeof rawMsg === 'object' && rawMsg?.content) {
                        if (typeof rawMsg.content === 'string') {
                          title = rawMsg.content.slice(0, 100).replace(/\n/g, ' ')
                        } else if (Array.isArray(rawMsg.content)) {
                          const textBlock = rawMsg.content.find(b => b.type === 'text')
                          if (textBlock?.text) {
                            title = textBlock.text.slice(0, 100).replace(/\n/g, ' ')
                          }
                        }
                      } else if (parsed.text) {
                        title = parsed.text.slice(0, 100).replace(/\n/g, ' ')
                      }
                    }
                  }
                }
              }

              const session: UnifiedSession = {
                id,
                cli: 'claude',
                category: 'cli',
                title: title || `Claude Session ${id.slice(0, 8)}`,
                cwd: cwd || pDir.replace(/^-/, '/').replace(/-/g, '/'),
                createdAt: stat.birthtimeMs || stat.ctimeMs,
                updatedAt: stat.mtimeMs,
                messageCount,
                rawLocation: filePath
              }

              this.sessionInfoCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, session })
              sessions.push(session)
            } catch (err) {
              console.warn(`[ClaudePlugin] Skipping unreadable session file ${filePath}:`, err)
            }
          }
        }
      }
    } catch (err) {
      console.error('[ClaudePlugin] Failed to scan sessions directory:', err)
    }

    return sessions
  }

  getMessages(_id: string, session?: UnifiedSession): SessionMessage[] {
    if (!session || !fs.existsSync(session.rawLocation)) return []
    const lines = this.readJsonl<ClaudeJsonlLine>(session.rawLocation)
    const messages: SessionMessage[] = []

    for (const parsed of lines) {
      const msgObj = typeof parsed.message === 'object' ? parsed.message : undefined
      const isUser = parsed.type === 'user' || parsed.role === 'user' || msgObj?.role === 'user'
      const isAssistant = parsed.type === 'assistant' || parsed.role === 'assistant' || msgObj?.role === 'assistant'

      if (!isUser && !isAssistant) continue

      let role: SessionMessage['role'] = isUser ? 'user' : 'assistant'
      let textContent = ''
      let thought = ''
      const toolCalls: SessionToolCall[] = []

      const rawContent = msgObj?.content !== undefined
        ? msgObj.content
        : (typeof parsed.message === 'string' ? parsed.message : parsed.text)

      if (typeof rawContent === 'string') {
        textContent = rawContent
      } else if (Array.isArray(rawContent)) {
        let hasToolResult = false
        let hasUserText = false

        for (const b of rawContent) {
          if (b.type === 'text') {
            hasUserText = true
            textContent += (textContent ? '\n\n' : '') + (b.text || '')
          } else if (b.type === 'thinking') {
            thought += (thought ? '\n' : '') + (b.thinking || '')
          } else if (b.type === 'tool_use') {
            toolCalls.push({
              id: b.id,
              name: b.name || 'tool',
              arguments: b.input || {}
            })
          } else if (b.type === 'tool_result') {
            hasToolResult = true
            const resText = typeof b.content === 'string' ? b.content : (b.content ? JSON.stringify(b.content) : '')
            if (resText) {
              textContent += (textContent ? '\n\n' : '') + resText
            }
          }
        }

        if (isUser && hasToolResult && !hasUserText) {
          role = 'tool'
        }
      }

      if (parsed.tool_use) {
        toolCalls.push(parsed.tool_use as SessionToolCall)
      }

      if (textContent || thought || toolCalls.length) {
        let ts: number | undefined
        if (parsed.timestamp) {
          const t = new Date(parsed.timestamp).getTime()
          if (!isNaN(t)) ts = t
        }

        messages.push({
          id: parsed.uuid || parsed.id || msgObj?.id,
          role,
          content: textContent,
          thought: thought || undefined,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          timestamp: ts,
          model: msgObj?.model || parsed.model
        })
      }
    }

    return messages
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const targetCwd = payload.cwd || os.homedir()
    const now = Date.now()
    const id = `session_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`
    const folderName = `-${targetCwd.replace(/^\//, '').replace(/\//g, '-')}`
    const pDir = path.join(this.baseDir, folderName)
    if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true })

    const filePath = path.join(pDir, `${id}.jsonl`)
    let content = ''
    if (payload.initialPrompt) {
      content += JSON.stringify({
        type: 'user',
        id: `msg_${Date.now()}`,
        cwd: targetCwd,
        message: {
          role: 'user',
          content: payload.initialPrompt
        },
        timestamp: new Date(now).toISOString()
      }) + '\n'
    } else {
      content += JSON.stringify({
        type: 'session_init',
        cwd: targetCwd,
        timestamp: new Date(now).toISOString()
      }) + '\n'
    }

    fs.writeFileSync(filePath, content, 'utf-8')

    return {
      id,
      cli: 'claude',
      category: 'cli',
      title: payload.title || payload.initialPrompt || `Claude Session ${id.slice(0, 8)}`,
      cwd: targetCwd,
      createdAt: now,
      updatedAt: now,
      messageCount: payload.initialPrompt ? 1 : 0,
      rawLocation: filePath
    }
  }

  updateSession(id: string, payload: UpdateSessionPayload): boolean {
    if (!payload.title) return false
    const session = this.getSessions().find(s => s.id === id)
    if (!session || !fs.existsSync(session.rawLocation)) return false

    try {
      const raw = fs.readFileSync(session.rawLocation, 'utf-8')
      const lines: string[] = raw.split('\n').filter(Boolean)
      let customTitleFound = false
      const updatedLines = lines.map((line: string) => {
        try {
          const parsed = JSON.parse(line) as ClaudeJsonlLine
          if (parsed.type === 'custom_title') {
            customTitleFound = true
            parsed.title = payload.title
            parsed.updatedAt = Date.now()
            return JSON.stringify(parsed)
          } else if (parsed.type === 'ai-title') {
            parsed.aiTitle = payload.title
            return JSON.stringify(parsed)
          } else if (parsed.type === 'session_init') {
            parsed.title = payload.title
            return JSON.stringify(parsed)
          }
        } catch {
          // ignore
        }
        return line
      })

      if (!customTitleFound) {
        const customTitleObj = {
          type: 'custom_title',
          title: payload.title,
          updatedAt: Date.now()
        }
        updatedLines.unshift(JSON.stringify(customTitleObj))
      }

      fs.writeFileSync(session.rawLocation, updatedLines.join('\n') + '\n', 'utf-8')
      return true
    } catch (e) {
      console.error('[ClaudePlugin] Failed updating session title:', e)
      return false
    }
  }

  deleteSession(id: string): boolean {
    const session = this.getSessions().find(s => s.id === id)
    if (session?.rawLocation && fs.existsSync(session.rawLocation)) {
      try {
        fs.unlinkSync(session.rawLocation)
        const dirWithoutExt = session.rawLocation.replace(/\.jsonl$/, '')
        if (fs.existsSync(dirWithoutExt) && fs.statSync(dirWithoutExt).isDirectory()) {
          fs.rmSync(dirWithoutExt, { recursive: true, force: true })
        }
      } catch (e) {
        console.warn(`[ClaudePlugin] Error deleting file for ${id}:`, e)
      }
    }
    return true
  }
}

export const plugin = new ClaudePlugin()
export default plugin
