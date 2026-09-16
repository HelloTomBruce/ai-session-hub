import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type Database from 'better-sqlite3'
import { BaseSqliteAdapter } from '../base-sqlite-adapter'
import type { CreateSessionPayload, SessionMessage, SessionToolCall, UnifiedSession, UpdateSessionPayload } from '../types'

const homeDir = os.homedir()

/** Row shape of the conversation tables in the Cursor SQLite database. */
interface CursorConversationRow {
  id: string
  title?: string
  workspace_path?: string
  model?: string
  model_identifier?: string
  created_at?: number
  created_at_ms?: number
  updated_at?: number
  updated_at_ms?: number
}

/** Row shape of the message tables in the Cursor SQLite database. */
interface CursorMessageRow {
  id?: string
  role?: string
  content?: string
  tool_calls?: string
  reasoning_text?: string
  thinking_text?: string
  created_at?: number
  created_at_ms?: number
}

/** Part of a JSON-encoded message content array. */
interface CursorContentPart {
  type?: string
  text?: string
  content?: string
  [key: string]: unknown
}

/** Entry of a parsed `tool_calls` payload. */
interface CursorToolCallEntry {
  name?: string
  arguments?: unknown
  input?: unknown
  function?: {
    name?: string
    arguments?: unknown
  }
}

function findCursorDb(): string {
  // Cursor stores AI session data in various possible locations
  const base = path.join(homeDir, 'Library', 'Application Support', 'Cursor')
  const candidates = [
    path.join(base, 'ai-sessions.db'),
    path.join(base, 'sessions.db'),
    path.join(base, 'User', 'globalStorage', 'ai-sessions.db'),
    path.join(base, 'User', 'globalStorage', 'cursor-sessions.db'),
    // VS Code style workspace storage with state.vscdb
    path.join(base, 'User', 'workspaceStorage')
  ]

  for (const c of candidates) {
    if (fs.existsSync(c) && !fs.statSync(c).isDirectory()) return c
  }

  // If workspaceStorage dir exists, look for state.vscdb files that might contain chat data
  const wsDir = path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage')
  if (fs.existsSync(wsDir)) {
    try {
      const dirs = fs.readdirSync(wsDir)
      for (const d of dirs) {
        const stateDb = path.join(wsDir, d, 'state.vscdb')
        if (fs.existsSync(stateDb)) {
          // Try to determine if this contains chat data
          return stateDb
        }
      }
    } catch {
      // workspaceStorage not readable; fall back to the default candidate
    }
  }

  return candidates[0] || ''
}

export class CursorSessionAdapter extends BaseSqliteAdapter {
  constructor() {
    super({
      id: 'cursor',
      name: 'Cursor',
      category: 'app',
      dbPath: findCursorDb()
    })
  }

  getSessions(): UnifiedSession[] {
    if (!this.isAvailable()) return []
    let db!: Database.Database
    try {
      db = this.getDb(true)

      // Try multiple possible schemas
      let rows: CursorConversationRow[]
      try {
        rows = db.prepare(`
          SELECT id, title, description, workspace_path, model_identifier,
                 unixepoch_ms(created_at) as created_at_ms,
                 unixepoch_ms(updated_at) as updated_at_ms
          FROM AIConversation ORDER BY updated_at DESC
        `).all() as CursorConversationRow[]
      } catch {
        try {
          rows = db.prepare(`
            SELECT id, title, path as workspace_path, model,
                   created_at, updated_at
            FROM conversations ORDER BY updated_at DESC
          `).all() as CursorConversationRow[]
        } catch {
          rows = db.prepare(`
            SELECT id, title, workspace as workspace_path, model,
                   created_at, updated_at
            FROM sessions ORDER BY updated_at DESC
          `).all() as CursorConversationRow[]
        }
      }

      return rows.map(row => ({
        id: row.id,
        cli: 'cursor',
        category: 'app',
        title: row.title || `Cursor Session ${row.id.slice(0, 8)}`,
        cwd: row.workspace_path || '',
        createdAt: row.created_at_ms || row.created_at || Date.now(),
        updatedAt: row.updated_at_ms || row.updated_at || Date.now(),
        model: row.model || row.model_identifier || undefined,
        rawLocation: this.dbPath
      }))
    } catch {
      return []
    } finally {
      if (db) db.close()
    }
  }

  getMessages(id: string): SessionMessage[] {
    if (!this.isAvailable()) return []
    let db!: Database.Database
    const messages: SessionMessage[] = []
    try {
      db = this.getDb(true)

      // Try multiple possible message schemas
      let msgs: CursorMessageRow[]
      try {
        msgs = db.prepare(`
          SELECT id, role, content, tool_calls, reasoning_text,
                 unixepoch_ms(created_at) as created_at_ms
          FROM AIConversationMessage
          WHERE conversation_id = ?
          ORDER BY created_at ASC
        `).all(id) as CursorMessageRow[]
      } catch {
        try {
          msgs = db.prepare(`
            SELECT id, role, content, tool_calls, thinking_text as reasoning_text,
                   created_at
            FROM messages WHERE conversation_id = ? ORDER BY id ASC
          `).all(id) as CursorMessageRow[]
        } catch {
          try {
            msgs = db.prepare(`
              SELECT id, role, content, tool_calls, reasoning_text, created_at
              FROM messages WHERE session_id = ? ORDER BY id ASC
            `).all(id) as CursorMessageRow[]
          } catch {
            msgs = []
          }
        }
      }

      for (const m of msgs) {
        const role = (m.role || 'assistant') as SessionMessage['role']
        let content = ''
        const toolCalls: SessionToolCall[] = []
        let thought = ''

        // Parse content (may be JSON or plain text)
        if (typeof m.content === 'string') {
          try {
            const parsed: unknown = JSON.parse(m.content)
            if (Array.isArray(parsed)) {
              for (const part of parsed as CursorContentPart[]) {
                if (part.type === 'text') content += (content ? '\n\n' : '') + (part.text || part.content || '')
                if (part.type === 'thinking' || part.type === 'reasoning') thought += (thought ? '\n' : '') + (part.text || part.content || '')
                if (part.type === 'tool_use' || part.type === 'tool_call') toolCalls.push(part)
              }
            } else {
              const obj = parsed as { text?: string, content?: string } | null
              content = obj?.text || obj?.content || m.content
            }
          } catch {
            content = m.content
          }
        }

        // Parse tool_calls JSON
        if (m.tool_calls) {
          try {
            const tcData: unknown = typeof m.tool_calls === 'string' ? JSON.parse(m.tool_calls) : m.tool_calls
            if (Array.isArray(tcData)) {
              for (const tc of tcData as CursorToolCallEntry[]) {
                toolCalls.push({
                  name: tc.name || tc.function?.name || 'tool',
                  arguments: tc.arguments || tc.function?.arguments || tc.input || {}
                })
              }
            }
          } catch {
            // malformed tool_calls JSON; ignore it
          }
        }

        // Parse reasoning_text
        if (m.reasoning_text || m.thinking_text) {
          const rt = m.reasoning_text || m.thinking_text
          thought = (thought ? thought + '\n' : '') + (typeof rt === 'string' ? rt : JSON.stringify(rt))
        }

        messages.push({
          id: m.id,
          role,
          content: content || (thought ? `*(Thinking)*\n${thought}` : ''),
          timestamp: m.created_at_ms || m.created_at,
          thought: thought || undefined,
          toolCalls: toolCalls.length ? toolCalls : undefined
        })
      }
    } catch {
      return messages
    } finally {
      if (db) db.close()
    }
    return messages
  }

  updateSession(id: string, payload: UpdateSessionPayload): boolean {
    if (!this.isAvailable() || !payload.title) return false
    let db!: Database.Database
    try {
      db = this.getDb(false)
      try {
        const res = db.prepare(`UPDATE AIConversation SET title = ?, updated_at = ? WHERE id = ?`)
          .run(payload.title, Date.now(), id)
        return res.changes > 0
      } catch {
        try {
          const res = db.prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`)
            .run(payload.title, Date.now(), id)
          return res.changes > 0
        } catch {
          const res = db.prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`)
            .run(payload.title, Date.now(), id)
          return res.changes > 0
        }
      }
    } catch {
      return false
    } finally {
      if (db) db.close()
    }
  }

  deleteSession(id: string): boolean {
    if (!this.isAvailable()) return false
    let db!: Database.Database
    try {
      db = this.getDb(false)
      try {
        db.prepare(`DELETE FROM AIConversation WHERE id = ?`).run(id)
      } catch {
        try {
          db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id)
        } catch {
          db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id)
        }
      }
      return true
    } finally {
      if (db) db.close()
    }
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const targetCwd = payload.cwd || homeDir
    const now = Date.now()
    const id = `session_${Math.random().toString(36).substring(2, 10)}_${now}`

    if (this.isAvailable()) {
      let db!: Database.Database
      try {
        db = this.getDb(false)
        try {
          db.prepare(`INSERT INTO AIConversation (id, title, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
            .run(id, payload.title || 'New Cursor Session', targetCwd, now, now)
        } catch {
          try {
            db.prepare(`INSERT INTO conversations (id, title, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
              .run(id, payload.title || 'New Cursor Session', targetCwd, now, now)
          } catch {
            db.prepare(`INSERT INTO sessions (id, title, workspace, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
              .run(id, payload.title || 'New Cursor Session', targetCwd, now, now)
          }
        }
      } finally {
        if (db) db.close()
      }
    }

    return {
      id, cli: 'cursor', category: 'app',
      title: payload.title || `Cursor ${id.slice(0, 8)}`,
      cwd: targetCwd, createdAt: now, updatedAt: now,
      rawLocation: this.dbPath
    }
  }
}
