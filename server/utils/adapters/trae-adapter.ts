import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type Database from 'better-sqlite3'
import { BaseSqliteAdapter } from '../base-sqlite-adapter'
import type { CreateSessionPayload, SessionMessage, SessionToolCall, UnifiedSession, UpdateSessionPayload } from '../types'

const homeDir = os.homedir()

/** Row shape of the session/conversation tables in the Trae SQLite database. */
interface TraeSessionRow {
  id: string
  title?: string
  name?: string
  workspace?: string
  path?: string
  cwd?: string
  model?: string
  created_at?: number
  updated_at?: number
  message_count?: number
  tokens_used?: number
}

/** Row shape of the messages table in the Trae SQLite database. */
interface TraeMessageRow {
  id?: string
  role?: string
  content?: string | { text?: string }
  thought?: string
  thinking?: string
  tool_calls_json?: unknown
  toolCalls?: unknown
  timestamp?: number
  created_at?: number
}

function findTraeDb(): string {
  const candidates = [
    path.join(homeDir, 'Library', 'Application Support', 'trae', 'sessions.db'),
    path.join(homeDir, 'Library', 'Application Support', 'trae', 'data.db'),
    path.join(homeDir, 'Library', 'Application Support', 'com.trae.app', 'sessions.db'),
    path.join(homeDir, 'Library', 'Application Support', 'com.trae.app', 'data.db'),
    path.join(homeDir, '.trae', 'sessions.db'),
    path.join(homeDir, '.trae', 'data.db')
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return candidates[0] || ''
}

export class TraeSessionAdapter extends BaseSqliteAdapter {
  constructor() {
    super({
      id: 'trae',
      name: 'Trae',
      category: 'app',
      dbPath: findTraeDb()
    })
  }

  getSessions(): UnifiedSession[] {
    if (!this.isAvailable()) return []
    let db!: Database.Database
    try {
      db = this.getDb(true)
      // Try different table name possibilities
      let rows: TraeSessionRow[]
      try {
        rows = db.prepare(`
          SELECT id, title, workspace, model, created_at, updated_at, message_count, tokens_used
          FROM sessions ORDER BY updated_at DESC
        `).all() as TraeSessionRow[]
      } catch {
        try {
          rows = db.prepare(`
            SELECT id, name as title, path as workspace, model, created_at as created_at, updated_at as updated_at
            FROM conversations ORDER BY updated_at DESC
          `).all() as TraeSessionRow[]
        } catch {
          rows = db.prepare(`
            SELECT id, title, cwd as workspace, model, created_at, updated_at, message_count
            FROM conversations ORDER BY updated_at DESC
          `).all() as TraeSessionRow[]
        }
      }

      return rows.map(row => ({
        id: row.id,
        cli: 'trae',
        category: 'app',
        title: row.title || `Trae Session ${row.id.slice(0, 8)}`,
        cwd: row.workspace || '',
        createdAt: row.created_at || Date.now(),
        updatedAt: row.updated_at || Date.now(),
        messageCount: row.message_count || undefined,
        model: row.model || undefined,
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
      let msgs: TraeMessageRow[]
      try {
        msgs = db.prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC`).all(id) as TraeMessageRow[]
      } catch {
        try {
          msgs = db.prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`).all(id) as TraeMessageRow[]
        } catch {
          msgs = db.prepare(`SELECT role, content, created_at as timestamp FROM messages WHERE session_id = ? ORDER BY id ASC`).all(id) as TraeMessageRow[]
        }
      }

      for (const m of msgs) {
        const role = (m.role || 'assistant') as SessionMessage['role']
        const content = typeof m.content === 'string' ? m.content : (m.content?.text || '')
        const thought = m.thought || m.thinking || ''
        let toolCalls: SessionToolCall[] = []

        // Try parsing JSON content
        if (m.tool_calls_json || m.toolCalls) {
          try {
            const rawToolCalls = m.tool_calls_json || m.toolCalls
            toolCalls = (typeof rawToolCalls === 'string' ? JSON.parse(rawToolCalls) : rawToolCalls) as SessionToolCall[]
          } catch {
            // malformed tool call JSON; keep empty tool calls
          }
        }

        messages.push({
          id: m.id,
          role,
          content: content || (thought ? `*(Thinking)*\n${thought}` : ''),
          timestamp: m.timestamp || m.created_at,
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
        const res = db.prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`).run(payload.title, Date.now(), id)
        return res.changes > 0
      } catch {
        const res = db.prepare(`UPDATE conversations SET name = ?, updated_at = ? WHERE id = ?`).run(payload.title, Date.now(), id)
        return res.changes > 0
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
        db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id)
      } catch {
        db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id)
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
          db.prepare(`INSERT INTO sessions (id, title, workspace, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
            .run(id, payload.title || 'New Trae Session', targetCwd, now, now)
        } catch {
          db.prepare(`INSERT INTO conversations (id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
            .run(id, payload.title || 'New Trae Session', targetCwd, now, now)
        }
      } finally {
        if (db) db.close()
      }
    }

    return {
      id, cli: 'trae', category: 'app',
      title: payload.title || `Trae ${id.slice(0, 8)}`,
      cwd: targetCwd, createdAt: now, updatedAt: now,
      rawLocation: this.dbPath
    }
  }
}
