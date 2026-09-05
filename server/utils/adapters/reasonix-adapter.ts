import path from 'node:path'
import os from 'node:os'
import { BaseSqliteAdapter } from '../base-sqlite-adapter'
import type { CreateSessionPayload, SessionMessage, UnifiedSession, UpdateSessionPayload } from '../types'

const homeDir = os.homedir()

export class ReasonixSessionAdapter extends BaseSqliteAdapter {
  constructor() {
    super({
      id: 'reasonix',
      name: 'Reasonix',
      category: 'app',
      dbPath: path.join(homeDir, '.reasonix', 'desktop', 'topic-state-v1.sqlite')
    })
  }

  getSessions(): UnifiedSession[] {
    if (!this.isAvailable()) return []
    let db: any
    try {
      db = this.getDb(true)
      const rows = db.prepare(`
        SELECT topic_id, title, created_at_ms, updated_at_ms, auto_meta_json
        FROM topics
        ORDER BY COALESCE(updated_at_ms, created_at_ms) DESC
      `).all()

      return rows.map((row: any) => {
        let cwd = ''
        let model = ''
        try {
          if (row.auto_meta_json) {
            const meta = JSON.parse(row.auto_meta_json)
            cwd = meta.cwd || meta.workspace || ''
            model = meta.model || ''
          }
        } catch {}

        return {
          id: row.topic_id,
          cli: 'reasonix',
          category: 'app',
          title: row.title || `Reasonix Topic ${row.topic_id.slice(0, 8)}`,
          cwd: cwd || path.join(homeDir, '.reasonix', 'global-workspace'),
          createdAt: row.created_at_ms || Date.now(),
          updatedAt: row.updated_at_ms || row.created_at_ms || Date.now(),
          model,
          rawLocation: this.dbPath,
          extra: {
            topic_id: row.topic_id
          }
        }
      })
    } catch {
      return []
    } finally {
      if (db) db.close()
    }
  }

  getMessages(_id: string, session?: UnifiedSession): SessionMessage[] {
    const messages: SessionMessage[] = []
    if (session) {
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
    let db: any
    try {
      db = this.getDb(false)
      if (payload.title) {
        db.prepare(`UPDATE topics SET title = ?, updated_at_ms = ? WHERE topic_id = ?`).run(payload.title, Date.now(), id)
        return true
      }
    } finally {
      if (db) db.close()
    }
    return false
  }

  deleteSession(id: string): boolean {
    if (!this.isAvailable()) return false
    let db: any
    try {
      db = this.getDb(false)
      db.prepare(`DELETE FROM topics WHERE topic_id = ?`).run(id)
      return true
    } finally {
      if (db) db.close()
    }
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const targetCwd = payload.cwd || homeDir
    const now = Date.now()
    const id = `session_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`

    if (this.isAvailable()) {
      let db: any
      try {
        db = this.getDb(false)
        db.prepare(`
          INSERT INTO topics (topic_id, title, created_at_ms, updated_at_ms, auto_meta_json)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, payload.title || 'New Reasonix Topic', now, now, JSON.stringify({ cwd: targetCwd }))
      } finally {
        if (db) db.close()
      }
    }

    return {
      id,
      cli: 'reasonix',
      category: 'app',
      title: payload.title || `Reasonix ${id.slice(0, 8)}`,
      cwd: targetCwd,
      createdAt: now,
      updatedAt: now,
      rawLocation: this.dbPath
    }
  }
}
