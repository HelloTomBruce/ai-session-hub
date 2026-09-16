import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { BaseJsonlAdapter } from '../base-jsonl-adapter'
import type { CreateSessionPayload, SessionMessage, SessionToolCall, UnifiedSession, UpdateSessionPayload } from '../types'

const homeDir = os.homedir()

/** Shape of a single line in a Kimi `context.jsonl` session file. */
interface KimiContextLine {
  id?: string
  role?: string
  content?: unknown
  timestamp?: number
  model?: string
  name?: string
  tool_name?: string
  arguments?: unknown
  args?: unknown
  input?: unknown
  tool_calls?: Array<{
    name?: string
    arguments?: unknown
    function?: {
      name?: string
      arguments?: unknown
    }
  }>
}

interface KimiWorkDirMeta {
  path: string
  kaos?: string
  last_session_id?: string | null
}

interface KimiMetadata {
  work_dirs: KimiWorkDirMeta[]
}

export class KimiSessionAdapter extends BaseJsonlAdapter {
  constructor() {
    super({
      id: 'kimi',
      name: 'Kimi CLI',
      category: 'cli',
      baseDir: path.join(homeDir, '.kimi')
    })
  }

  private getMetadata(): KimiMetadata {
    const metaFile = path.join(this.baseDir, 'kimi.json')
    if (!fs.existsSync(metaFile)) return { work_dirs: [] }
    try {
      return JSON.parse(fs.readFileSync(metaFile, 'utf-8'))
    } catch {
      return { work_dirs: [] }
    }
  }

  private md5Path(p: string): string {
    return crypto.createHash('md5').update(p, 'utf-8').digest('hex')
  }

  getSessions(): UnifiedSession[] {
    if (!this.isAvailable()) return []
    const sessions: UnifiedSession[] = []
    const metadata = this.getMetadata()
    const sessionsBase = path.join(this.baseDir, 'sessions')

    if (!fs.existsSync(sessionsBase)) return sessions

    try {
      for (const wd of metadata.work_dirs) {
        const dirHash = this.md5Path(wd.path)
        const sessionDir = path.join(sessionsBase, dirHash)
        if (!fs.existsSync(sessionDir)) continue

        const entries = fs.readdirSync(sessionDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const sid = entry.name
          const ctxFile = path.join(sessionDir, sid, 'context.jsonl')
          const stateFile = path.join(sessionDir, sid, 'state.json')
          if (!fs.existsSync(ctxFile)) continue

          try {
            const stat = fs.statSync(ctxFile)
            const lines = this.readJsonl<KimiContextLine>(ctxFile)
            let title = ''
            let messageCount = 0
            let model = ''

            // Try state.json for custom_title
            if (fs.existsSync(stateFile)) {
              try {
                const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
                if (state.custom_title) title = state.custom_title
                if (state.title_generated) title = state.title_generated
              } catch {
                // ignore malformed state.json
              }
            }

            for (const parsed of lines) {
              const role = parsed.role || ''
              if (role === 'user' || role === 'assistant') {
                messageCount++
                if (!title && role === 'user') {
                  const txt = typeof parsed.content === 'string' ? parsed.content : ''
                  if (txt) title = txt.slice(0, 100).replace(/\n/g, ' ')
                }
              }
              if (!model && parsed.model) model = parsed.model
            }

            sessions.push({
              id: sid,
              cli: 'kimi',
              category: 'cli',
              title: title || `Kimi Session ${sid.slice(0, 8)}`,
              cwd: wd.path,
              createdAt: stat.birthtimeMs || stat.ctimeMs,
              updatedAt: stat.mtimeMs,
              messageCount,
              model: model || undefined,
              rawLocation: ctxFile
            })
          } catch {
            // skip sessions that fail to parse
          }
        }
      }
    } catch {
      // ignore errors while scanning kimi sessions
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getMessages(_id: string, session?: UnifiedSession): SessionMessage[] {
    if (!session || !fs.existsSync(session.rawLocation)) return []
    const lines = this.readJsonl<KimiContextLine>(session.rawLocation)
    const messages: SessionMessage[] = []

    for (const parsed of lines) {
      const role = parsed.role || ''
      let content: string
      let thought: string | undefined
      const toolCalls: SessionToolCall[] = []

      if (role === 'user') {
        content = typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content || '')
        messages.push({ id: parsed.id, role: 'user', content, timestamp: parsed.timestamp })
      } else if (role === 'assistant') {
        content = typeof parsed.content === 'string' ? parsed.content : ''
        if (Array.isArray(parsed.tool_calls)) {
          for (const tc of parsed.tool_calls) {
            toolCalls.push({ name: tc.name || tc.function?.name || 'tool', arguments: tc.arguments || tc.function?.arguments || {} })
          }
        }
        messages.push({
          id: parsed.id,
          role: 'assistant',
          content,
          timestamp: parsed.timestamp,
          model: parsed.model,
          toolCalls: toolCalls.length ? toolCalls : undefined
        })
      } else if (role === '_thinking' || role === 'thinking') {
        thought = typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content || '')
        // Merge thought into previous assistant message if exists
        const lastMsg = messages[messages.length - 1]
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.thought = (lastMsg.thought || '') + (lastMsg.thought ? '\n' : '') + thought
        } else {
          messages.push({ id: parsed.id, role: 'assistant', content: `*(Thinking)*\n${thought}`, thought, timestamp: parsed.timestamp })
        }
      } else if (role === '_tool_call' || role === 'tool_call') {
        toolCalls.push({
          name: parsed.name || parsed.tool_name || 'tool',
          arguments: parsed.arguments || parsed.args || parsed.input || {}
        })
      } else if (role === '_tool_result' || role === 'tool_result') {
        messages.push({ id: parsed.id, role: 'tool', content: typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content || ''), timestamp: parsed.timestamp })
      }
    }

    return messages
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const targetCwd = payload.cwd || homeDir
    const now = Date.now()
    const id = `session_${Math.random().toString(36).substring(2, 10)}_${now}`
    const dirHash = this.md5Path(targetCwd)
    const sessDir = path.join(this.baseDir, 'sessions', dirHash, id)
    fs.mkdirSync(sessDir, { recursive: true })

    const ctxFile = path.join(sessDir, 'context.jsonl')
    const firstLines: KimiContextLine[] = []

    if (payload.initialPrompt) {
      firstLines.push({ role: 'user', content: payload.initialPrompt, timestamp: now })
    }
    fs.writeFileSync(ctxFile, firstLines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf-8')

    // Update kimi.json metadata
    const meta = this.getMetadata()
    if (!meta.work_dirs.some(w => w.path === targetCwd)) {
      meta.work_dirs.push({ path: targetCwd, kaos: 'local', last_session_id: id })
      try {
        fs.writeFileSync(path.join(this.baseDir, 'kimi.json'), JSON.stringify(meta, null, 2), 'utf-8')
      } catch {
        // ignore metadata write failures
      }
    }

    return {
      id, cli: 'kimi', category: 'cli',
      title: payload.title || `Kimi ${id.slice(0, 8)}`,
      cwd: targetCwd, createdAt: now, updatedAt: now,
      messageCount: payload.initialPrompt ? 1 : 0, rawLocation: ctxFile
    }
  }

  override updateSession(id: string, payload: UpdateSessionPayload): boolean {
    if (!payload.title) return false
    const session = this.getSessions().find(s => s.id === id)
    if (!session) return false

    const stateFile = path.join(path.dirname(session.rawLocation), 'state.json')
    try {
      let state: Record<string, unknown> = {}
      if (fs.existsSync(stateFile)) {
        state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'))
      }
      state.custom_title = payload.title
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8')
      return true
    } catch { return false }
  }

  override deleteSession(id: string): boolean {
    const session = this.getSessions().find(s => s.id === id)
    if (!session) return false
    const dirPath = path.dirname(session.rawLocation)
    try {
      fs.rmSync(dirPath, { recursive: true, force: true })
      return true
    } catch { return false }
  }
}
