import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'
import type {
  SessionPlugin,
  SessionPluginManifest,
  UnifiedSession,
  SessionMessage,
  CreateSessionPayload,
  UpdateSessionPayload
} from '@session-hub/core'

interface WorkBuddySessionRow {
  id: string
  cwd?: string
  title?: string
  custom_title?: string
  status?: string
  created_at?: number
  updated_at?: number
  last_activity_at?: number
  model?: string
  mode?: string
  expert_id?: string
}

interface WorkBuddyReasoningChunk {
  text?: string
}

interface WorkBuddyLogLine {
  id?: string
  type?: string
  role?: string
  name?: string
  arguments?: unknown
  content?: string
  message?: string
  rawContent?: WorkBuddyReasoningChunk[]
  timestamp?: number
}

export class WorkBuddyPlugin implements SessionPlugin {
  readonly manifest: SessionPluginManifest = {
    id: 'workbuddy',
    name: 'WorkBuddy',
    category: 'app',
    icon: 'i-lucide-briefcase',
    version: '1.0.0',
    description: 'WorkBuddy 智能工作助手桌面端，支持任务追踪、专家模型与项目会话',
    author: 'Session Hub Team',
    type: 'builtin',
    defaultEnabled: true
  }

  private dbPath: string

  constructor(customDbPath?: string) {
    this.dbPath = customDbPath || path.join(os.homedir(), '.workbuddy', 'workbuddy.db')
  }

  isAvailable(): boolean {
    return fs.existsSync(this.dbPath)
  }

  private getDb(readonly = true): Database.Database {
    return new Database(this.dbPath, { readonly, fileMustExist: true })
  }

  getSessions(): UnifiedSession[] {
    if (!this.isAvailable()) return []
    let db: Database.Database | undefined
    try {
      db = this.getDb(true)
      const rows = db.prepare(`
        SELECT id, cwd, title, custom_title, status, created_at, updated_at, last_activity_at, model, mode, expert_id
        FROM sessions
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC
      `).all() as WorkBuddySessionRow[]

      return rows.map(row => ({
        id: row.id,
        cli: 'workbuddy',
        category: 'app',
        title: row.custom_title || row.title || `WorkBuddy ${row.id.slice(0, 8)}`,
        cwd: row.cwd || '',
        createdAt: row.created_at as number,
        updatedAt: row.last_activity_at || row.updated_at || Date.now(),
        status: row.status,
        model: row.model,
        rawLocation: this.dbPath,
        extra: {
          mode: row.mode,
          expert_id: row.expert_id
        }
      }))
    } catch {
      return []
    } finally {
      if (db) db.close()
    }
  }

  getMessages(id: string, session?: UnifiedSession): SessionMessage[] {
    const wbProjectsDir = path.join(os.homedir(), '.workbuddy', 'projects')
    const messages: SessionMessage[] = []

    if (fs.existsSync(wbProjectsDir)) {
      try {
        const pFolders = fs.readdirSync(wbProjectsDir)
        for (const f of pFolders) {
          const jsonlFile = path.join(wbProjectsDir, f, `${id}.jsonl`)
          if (fs.existsSync(jsonlFile)) {
            const lines = fs.readFileSync(jsonlFile, 'utf-8').split('\n').filter(Boolean)
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line) as WorkBuddyLogLine
                if (parsed.type === 'reasoning' && parsed.rawContent?.length) {
                  const thought = parsed.rawContent.map(r => r.text).join('\n')
                  messages.push({
                    id: parsed.id,
                    role: 'assistant',
                    content: `*(Reasoning)*\n${thought}`,
                    thought,
                    timestamp: parsed.timestamp
                  })
                } else if (parsed.type === 'function_call') {
                  messages.push({
                    id: parsed.id,
                    role: 'tool',
                    content: `Function Call: ${parsed.name}`,
                    toolCalls: [{ name: parsed.name, arguments: parsed.arguments }],
                    timestamp: parsed.timestamp
                  })
                } else if (parsed.type === 'user_message' || parsed.role === 'user') {
                  messages.push({
                    id: parsed.id,
                    role: 'user',
                    content: parsed.content || parsed.message || '',
                    timestamp: parsed.timestamp
                  })
                }
              } catch {
                // skip malformed
              }
            }
            break
          }
        }
      } catch {
        // ignore
      }
    }

    if (messages.length === 0 && session) {
      messages.push({
        role: 'user',
        content: session.title,
        timestamp: session.createdAt
      })
    }

    return messages
  }

  updateSession(id: string, payload: UpdateSessionPayload): boolean {
    if (!this.isAvailable()) return false
    let db: Database.Database | undefined
    try {
      db = this.getDb(false)
      if (payload.title) {
        const res = db.prepare(`UPDATE sessions SET custom_title = ?, title = ?, updated_at = ? WHERE id = ?`).run(payload.title, payload.title, Date.now(), id)
        return res.changes > 0
      }
    } catch (e) {
      console.error('[WorkBuddyPlugin] Failed updating session:', e)
    } finally {
      if (db) db.close()
    }
    return false
  }

  deleteSession(id: string): boolean {
    if (!this.isAvailable()) return false
    let db: Database.Database | undefined
    try {
      db = this.getDb(false)
      db.prepare(`UPDATE sessions SET deleted_at = ? WHERE id = ?`).run(Date.now(), id)
      return true
    } finally {
      if (db) db.close()
    }
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const targetCwd = payload.cwd || os.homedir()
    const now = Date.now()
    const id = `session_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`

    if (this.isAvailable()) {
      let db: Database.Database | undefined
      try {
        db = this.getDb(false)
        db.prepare(`
          INSERT INTO sessions (id, cwd, user_id, title, custom_title, status, created_at, updated_at)
          VALUES (?, ?, 'default_user', ?, ?, 'Active', ?, ?)
        `).run(id, targetCwd, payload.title || 'New WorkBuddy Session', payload.title || 'New WorkBuddy Session', now, now)
      } finally {
        if (db) db.close()
      }
    }

    return {
      id,
      cli: 'workbuddy',
      category: 'app',
      title: payload.title || `WorkBuddy ${id.slice(0, 8)}`,
      cwd: targetCwd,
      createdAt: now,
      updatedAt: now,
      rawLocation: this.dbPath
    }
  }
}

export const plugin = new WorkBuddyPlugin()
export default plugin
