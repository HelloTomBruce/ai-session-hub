import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { BaseJsonlAdapter } from '../base-jsonl-adapter'
import type { CreateSessionPayload, SessionMessage, UnifiedSession, UpdateSessionPayload } from '../types'

const homeDir = os.homedir()

export class MimoSessionAdapter extends BaseJsonlAdapter {
  constructor() {
    super({
      id: 'mimo',
      name: 'Mimo CLI',
      category: 'cli',
      baseDir: path.join(homeDir, '.mimocode')
    })
  }

  getSessions(): UnifiedSession[] {
    const sessions: UnifiedSession[] = []
    if (!this.isAvailable()) return sessions

    try {
      // Mimo sessions are stored at various levels:
      // 1. ~/.mimocode/sessions/{project_dir}/{session_id}.jsonl (global)
      // 2. {project}/.mimocode/ (per-project, contains the same structure)

      const sessionsDir = path.join(this.baseDir, 'sessions')
      if (fs.existsSync(sessionsDir)) {
        this.collectSessionsFromDir(sessionsDir, sessions)
      }

      // Also look for per-project .mimocode directories
      // These may contain session data too
      const projects = this.discoverProjectDirs()
      for (const projDir of projects) {
        const projSessionsDir = path.join(projDir, '.mimocode', 'sessions')
        if (fs.existsSync(projSessionsDir)) {
          this.collectSessionsFromDir(projSessionsDir, sessions, projDir)
        }
      }
    } catch {}

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private collectSessionsFromDir(sessionsDir: string, sessions: UnifiedSession[], projectCwd?: string): void {
    try {
      const projectDirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
      for (const entry of projectDirs) {
        if (!entry.isDirectory()) continue
        const fullDir = path.join(sessionsDir, entry.name)
        const files = fs.readdirSync(fullDir)
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue
          const filePath = path.join(fullDir, file)
          try {
            const stat = fs.statSync(filePath)
            const lines = this.readJsonl(filePath)
            const id = file.replace('.jsonl', '')
            let title = ''
            let cwd = projectCwd || ''
            let messageCount = 0
            let model = ''

            for (const parsed of lines) {
              if (parsed.type === 'session') {
                cwd = parsed.cwd || cwd
                if (parsed.title) title = parsed.title
                if (parsed.model) model = parsed.model
              } else if (parsed.type === 'message' || (parsed.role && parsed.role !== 'system')) {
                messageCount++
                if (!title && (parsed.role === 'user' || parsed.role === 'human')) {
                  const text = typeof parsed.content === 'string'
                    ? parsed.content
                    : parsed.message || parsed.text || ''
                  if (text) title = text.slice(0, 100).replace(/\n/g, ' ')
                }
              }
            }

            sessions.push({
              id,
              cli: 'mimo',
              category: 'cli',
              title: title || `Mimo Session ${id.slice(0, 8)}`,
              cwd: cwd || entry.name.replace(/--/g, '/').replace(/^-/, '').replace(/-/g, '/'),
              createdAt: stat.birthtimeMs || stat.ctimeMs,
              updatedAt: stat.mtimeMs,
              messageCount,
              model: model || undefined,
              rawLocation: filePath
            })
          } catch {}
        }
      }
    } catch {}
  }

  private discoverProjectDirs(): string[] {
    const projectDirs: string[] = []
    // Scan common locations for .mimocode dirs
    // First check ~/.mimocode for project references
    try {
      const items = fs.readdirSync(this.baseDir)
      for (const item of items) {
        const full = path.join(this.baseDir, item)
        if (fs.statSync(full).isDirectory() && item !== 'sessions' && !item.startsWith('.')) {
          projectDirs.push(full)
        }
      }
    } catch {}

    return projectDirs
  }

  getMessages(_id: string, session?: UnifiedSession): SessionMessage[] {
    if (!session || !fs.existsSync(session.rawLocation)) return []
    const lines = this.readJsonl(session.rawLocation)
    const messages: SessionMessage[] = []

    for (const parsed of lines) {
      if (parsed.type === 'session' || parsed.type === 'session_init') {
        continue // Skip metadata lines
      }

      const role = parsed.role || parsed.type || 'assistant'
      let content: string
      let thought: string | undefined
      const toolCalls: any[] = []

      if (parsed.type === 'message' || parsed.type) {
        const c = parsed.content || parsed.message || parsed.text || ''
        const tc = parsed.toolCalls || parsed.tool_calls || []

        if (role === 'user' || parsed.type === 'user') {
          content = typeof c === 'string' ? c : JSON.stringify(c)
          messages.push({ id: parsed.id, role: 'user', content, timestamp: parsed.timestamp })
        } else if (role === 'assistant' || parsed.type === 'assistant') {
          content = typeof c === 'string' ? c : ''
          thought = parsed.thought || parsed.thinking || ''
          if (Array.isArray(tc)) {
            for (const t of tc) {
              toolCalls.push({
                name: t.name || t.function?.name || 'tool',
                arguments: t.arguments || t.function?.arguments || t.input || {}
              })
            }
          }
          messages.push({
            id: parsed.id,
            role: 'assistant',
            content: content || (thought ? `*(Thinking)*\n${thought}` : ''),
            timestamp: parsed.timestamp,
            thought: thought || undefined,
            toolCalls: toolCalls.length ? toolCalls : undefined
          })
        } else if (role === 'tool' || parsed.type === 'tool_call' || parsed.type === 'tool_result') {
          content = typeof c === 'string' ? c : JSON.stringify(c)
          messages.push({ id: parsed.id, role: 'tool', content, timestamp: parsed.timestamp })
        }
      }
    }

    return messages
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const targetCwd = payload.cwd || homeDir
    const now = Date.now()
    const id = `session_${Math.random().toString(36).substring(2, 10)}_${now}`

    const folderName = `--${targetCwd.replace(/^\//, '').replace(/\//g, '-')}--`
    const sessDir = path.join(this.baseDir, 'sessions', folderName)
    fs.mkdirSync(sessDir, { recursive: true })

    const filePath = path.join(sessDir, `${id}.jsonl`)
    let content = JSON.stringify({
      type: 'session',
      id,
      timestamp: new Date().toISOString(),
      cwd: targetCwd,
      title: payload.title || ''
    }) + '\n'

    if (payload.initialPrompt) {
      content += JSON.stringify({
        type: 'message',
        role: 'user',
        content: payload.initialPrompt,
        timestamp: Date.now()
      }) + '\n'
    }

    fs.writeFileSync(filePath, content, 'utf-8')

    return {
      id, cli: 'mimo', category: 'cli',
      title: payload.title || payload.initialPrompt || `Mimo ${id.slice(0, 8)}`,
      cwd: targetCwd, createdAt: now, updatedAt: now,
      messageCount: payload.initialPrompt ? 1 : 0, rawLocation: filePath
    }
  }

  override updateSession(id: string, payload: UpdateSessionPayload): boolean {
    if (!payload.title) return false
    const session = this.getSessions().find(s => s.id === id)
    if (!session || !fs.existsSync(session.rawLocation)) return false

    try {
      const raw = fs.readFileSync(session.rawLocation, 'utf-8')
      const lines = raw.split('\n').filter(Boolean)
      const updatedLines = lines.map((line) => {
        try {
          const parsed = JSON.parse(line)
          if (parsed.type === 'session') {
            parsed.title = payload.title
            return JSON.stringify(parsed)
          }
        } catch {}
        return line
      })
      fs.writeFileSync(session.rawLocation, updatedLines.join('\n') + '\n', 'utf-8')
      return true
    } catch { return false }
  }

  override deleteSession(id: string): boolean {
    const session = this.getSessions().find(s => s.id === id)
    if (!session || !fs.existsSync(session.rawLocation)) return false
    try {
      fs.unlinkSync(session.rawLocation)
      return true
    } catch { return false }
  }
}
