import path from 'node:path'
import os from 'node:os'
import { BaseSqliteAdapter } from '../base-sqlite-adapter'
import type { CreateSessionPayload, SessionMessage, UnifiedSession, UpdateSessionPayload } from '../types'

const homeDir = os.homedir()

export class OpenCodeSessionAdapter extends BaseSqliteAdapter {
  constructor() {
    super({
      id: 'opencode',
      name: 'OpenCode CLI',
      category: 'cli',
      dbPath: path.join(homeDir, '.local', 'share', 'opencode', 'opencode.db')
    })
  }

  getSessions(): UnifiedSession[] {
    if (!this.isAvailable()) return []
    let db: any
    try {
      db = this.getDb(true)
      const rows = db.prepare(`
        SELECT id, slug, directory, path, title, cost, model, time_created, time_updated, summary_files, summary_additions, summary_deletions
        FROM session
        ORDER BY time_updated DESC
      `).all()

      return rows.map((row: any) => ({
        id: row.id,
        cli: 'opencode',
        category: 'cli',
        title: row.title || row.slug || `OpenCode ${row.id.slice(0, 8)}`,
        cwd: row.directory || row.path || '',
        createdAt: row.time_created || Date.now(),
        updatedAt: row.time_updated || Date.now(),
        cost: row.cost,
        model: row.model,
        rawLocation: this.dbPath,
        extra: {
          slug: row.slug,
          summary_files: row.summary_files,
          summary_additions: row.summary_additions,
          summary_deletions: row.summary_deletions
        }
      }))
    } catch {
      return []
    } finally {
      if (db) db.close()
    }
  }

  getMessages(id: string): SessionMessage[] {
    if (!this.isAvailable()) return []
    let db: any
    const messages: SessionMessage[] = []
    try {
      db = this.getDb(true)
      const msgs = db.prepare(`SELECT * FROM message WHERE session_id = ? ORDER BY time_created ASC`).all(id)
      for (const m of msgs) {
        let msgData: any = {}
        try {
          msgData = typeof m.data === 'string' ? JSON.parse(m.data) : (m.data || {})
        } catch {}

        const role = msgData.role || 'assistant'
        const model = msgData.model?.modelID || msgData.modelID || ''

        const parts = db.prepare(`SELECT * FROM part WHERE message_id = ? ORDER BY id ASC`).all(m.id)
        let content = ''
        let thought = ''
        const toolCalls: any[] = []

        for (const p of parts) {
          let pData: any = {}
          try {
            pData = typeof p.data === 'string' ? JSON.parse(p.data) : (p.data || {})
          } catch {}

          const pType = pData.type || p.type
          if (pType === 'text') {
            const text = pData.text || pData.content || ''
            if (text) content += (content ? '\n\n' : '') + text
          } else if (pType === 'reasoning') {
            const reasonText = pData.text || pData.content || ''
            if (reasonText) thought += (thought ? '\n' : '') + reasonText
          } else if (pType === 'tool' || pType === 'tool_call' || pType === 'tool_use') {
            toolCalls.push({
              name: pData.tool || pData.name || 'tool',
              arguments: pData.state?.input || pData.input || pData.args || pData.arguments || {},
              output: pData.state?.output || pData.output
            })
          }
        }

        if (content || thought || toolCalls.length) {
          messages.push({
            id: m.id,
            role,
            content: content || (thought ? `*(Thinking)*\n${thought}` : ''),
            timestamp: msgData.time?.created || m.time_created,
            model,
            thought: thought || undefined,
            toolCalls: toolCalls.length ? toolCalls : undefined
          })
        }
      }
    } finally {
      if (db) db.close()
    }

    return messages
  }

  updateSession(id: string, payload: UpdateSessionPayload): boolean {
    if (!this.isAvailable()) return false
    let db: any
    try {
      db = this.getDb(false)
      if (payload.title) {
        db.prepare(`UPDATE session SET title = ?, time_updated = ? WHERE id = ?`).run(payload.title, Date.now(), id)
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
      db.prepare(`DELETE FROM session WHERE id = ?`).run(id)
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
        const row = db.prepare(`SELECT id FROM project WHERE worktree = ? LIMIT 1`).get(targetCwd) as any
        const projectId = row?.id || 'global'
        db.prepare(`
          INSERT INTO session (id, project_id, slug, directory, title, version, cost, time_created, time_updated)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
        `).run(id, projectId, id, targetCwd, payload.title || 'New OpenCode Session', '1.0', now, now)
      } finally {
        if (db) db.close()
      }
    }

    return {
      id,
      cli: 'opencode',
      category: 'cli',
      title: payload.title || `OpenCode ${id.slice(0, 8)}`,
      cwd: targetCwd,
      createdAt: now,
      updatedAt: now,
      rawLocation: this.dbPath
    }
  }
}
