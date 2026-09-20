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

interface PiTextPart {
  type: 'text'
  text: string
}

interface PiThinkingPart {
  type: 'thinking'
  thinking: string
}

interface PiToolPart {
  type: 'toolCall' | 'toolUse'
  [key: string]: unknown
}

type PiContentPart = PiTextPart | PiThinkingPart | PiToolPart

interface PiLine {
  id?: string
  type?: string
  timestamp?: string | number
  model?: string
  title?: string
  cwd?: string
  modelId?: string
  message?: {
    role?: string
    content?: string | PiContentPart[]
    model?: string
  }
}

/**
 * Pi CLI 独立 npm 插件包实现
 */
export class PiPlugin implements SessionPlugin {
  readonly manifest: SessionPluginManifest = {
    id: 'pi',
    name: 'Pi CLI',
    category: 'cli',
    icon: 'i-lucide-terminal',
    version: '1.0.0',
    description: '轻量级多模型终端 Agent，支持树状会话、Skill 与 MCP 工具',
    author: 'Session Hub Team',
    type: 'builtin',
    defaultEnabled: true
  }

  private baseDir: string
  /** 列表解析结果缓存：key 为文件路径，mtime 变化时失效（避免 sync 双重全量解析） */
  private sessionInfoCache = new Map<string, { mtimeMs: number, size: number, session: UnifiedSession }>()

  constructor(customBaseDir?: string) {
    this.baseDir = customBaseDir || path.join(os.homedir(), '.pi', 'agent', 'sessions')
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
          // ignore invalid json line
        }
      }
      return items
    } catch (err) {
      console.error(`[PiPlugin] Failed to read ${filePath}:`, err)
      return []
    }
  }

  /** 将非标准 role 归一化到统一枚举，避免泄漏到前端渲染（如 toolResult） */
  private normalizeRole(role: string | undefined): SessionMessage['role'] {
    switch (role) {
      case 'user':
      case 'assistant':
      case 'system':
      case 'tool':
        return role
      case 'toolResult':
      case 'tool_result':
        return 'tool'
      default:
        return 'assistant'
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

              const lines = this.readJsonl<PiLine>(filePath)

              let id = file.replace('.jsonl', '')
              let cwd = ''
              let title = ''
              let model = ''
              let messageCount = 0

              for (const parsed of lines) {
                if (parsed.type === 'session') {
                  id = parsed.id || id
                  cwd = parsed.cwd || cwd
                  if (parsed.title) title = parsed.title
                } else if (parsed.type === 'custom_title' && parsed.title) {
                  title = parsed.title
                } else if (parsed.type === 'model_change') {
                  model = parsed.modelId || model
                } else if (parsed.type === 'message') {
                  messageCount++
                  if (!title && parsed.message?.role === 'user') {
                    const text = typeof parsed.message.content === 'string'
                      ? parsed.message.content
                      : Array.isArray(parsed.message.content)
                        ? parsed.message.content.find((c): c is PiTextPart => c.type === 'text')?.text || ''
                        : ''
                    if (text) title = text.slice(0, 100).replace(/\n/g, ' ')
                  }
                }
              }

              const session: UnifiedSession = {
                id,
                cli: 'pi',
                category: 'cli',
                title: title || `Pi Session ${id.slice(0, 8)}`,
                cwd: cwd || pDir.replace(/^--/, '/').replace(/--$/, '').replace(/-/g, '/'),
                createdAt: stat.birthtimeMs || stat.ctimeMs,
                updatedAt: stat.mtimeMs,
                messageCount,
                model,
                rawLocation: filePath
              }

              this.sessionInfoCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, session })
              sessions.push(session)
            } catch (err) {
              console.warn(`[PiPlugin] Skipping unreadable session file ${filePath}:`, err)
            }
          }
        }
      }
    } catch (err) {
      console.error('[PiPlugin] Failed to scan sessions directory:', err)
    }

    return sessions
  }

  getMessages(_id: string, session?: UnifiedSession): SessionMessage[] {
    if (!session || !fs.existsSync(session.rawLocation)) return []
    const lines = this.readJsonl<PiLine>(session.rawLocation)
    const messages: SessionMessage[] = []

    for (const parsed of lines) {
      if (parsed.type === 'message') {
        const role = this.normalizeRole(parsed.message?.role)
        let content = ''
        let thought = ''
        const toolCalls: SessionToolCall[] = []

        if (typeof parsed.message?.content === 'string') {
          content = parsed.message.content
        } else if (Array.isArray(parsed.message?.content)) {
          for (const part of parsed.message.content) {
            if (part.type === 'text') content += (content ? '\n' : '') + part.text
            if (part.type === 'thinking') thought += (thought ? '\n' : '') + part.thinking
            if (part.type === 'toolCall' || part.type === 'toolUse') toolCalls.push(part)
          }
        }

        messages.push({
          id: parsed.id,
          role,
          content: content || (thought ? `*(Thinking)*\n${thought}` : ''),
          timestamp: parsed.timestamp ? new Date(parsed.timestamp).getTime() : undefined,
          model: parsed.model || parsed.message?.model,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          thought: thought || undefined
        })
      }
    }

    return messages
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const targetCwd = payload.cwd || os.homedir()
    const now = Date.now()
    const id = `session_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`
    const folderName = `--${targetCwd.replace(/^\//, '').replace(/\//g, '-')}--`
    const piDir = path.join(this.baseDir, folderName)
    if (!fs.existsSync(piDir)) fs.mkdirSync(piDir, { recursive: true })

    const filePath = path.join(piDir, `${id}.jsonl`)
    const sessionHeader = JSON.stringify({
      type: 'session',
      version: 3,
      id,
      timestamp: new Date().toISOString(),
      cwd: targetCwd
    })

    let content = sessionHeader + '\n'
    if (payload.initialPrompt) {
      content += JSON.stringify({
        type: 'message',
        id: `msg_${Math.random().toString(36).substring(2, 8)}`,
        timestamp: new Date().toISOString(),
        message: {
          role: 'user',
          content: payload.initialPrompt,
          timestamp: Date.now()
        }
      }) + '\n'
    }

    fs.writeFileSync(filePath, content, 'utf-8')

    return {
      id,
      cli: 'pi',
      category: 'cli',
      title: payload.title || payload.initialPrompt || `Pi Session ${id.slice(0, 8)}`,
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
          const parsed = JSON.parse(line)
          if (parsed.type === 'session') {
            parsed.title = payload.title
            return JSON.stringify(parsed)
          } else if (parsed.type === 'custom_title') {
            customTitleFound = true
            parsed.title = payload.title
            parsed.updatedAt = Date.now()
            return JSON.stringify(parsed)
          }
        } catch {
          // ignore non-json line
        }
        return line
      })

      if (!customTitleFound) {
        const customTitleObj = {
          type: 'custom_title',
          title: payload.title,
          updatedAt: Date.now()
        }
        updatedLines.splice(1, 0, JSON.stringify(customTitleObj))
      }

      fs.writeFileSync(session.rawLocation, updatedLines.join('\n') + '\n', 'utf-8')
      return true
    } catch (e) {
      console.error('[PiPlugin] Failed updating session title:', e)
      return false
    }
  }

  deleteSession(id: string): boolean {
    const session = this.getSessions().find(s => s.id === id)
    if (!session || !fs.existsSync(session.rawLocation)) {
      return true
    }
    try {
      fs.unlinkSync(session.rawLocation)
      return true
    } catch {
      return true
    }
  }
}

export const plugin = new PiPlugin()
export default plugin
