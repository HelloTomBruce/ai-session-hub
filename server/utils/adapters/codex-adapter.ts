import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { BaseSqliteAdapter } from '../base-sqlite-adapter'
import type { CreateSessionPayload, SessionMessage, UnifiedSession, UpdateSessionPayload } from '../types'

const homeDir = os.homedir()

export class CodexSessionAdapter extends BaseSqliteAdapter {
  constructor() {
    super({
      id: 'codex',
      name: 'Codex App',
      category: 'app',
      dbPath: path.join(homeDir, '.codex', 'state_5.sqlite')
    })
  }

  private findRolloutPath(id: string, storedPath?: string): string {
    if (storedPath && fs.existsSync(storedPath)) return storedPath
    
    // Search in ~/.codex/sessions/
    const codexSessionsDir = path.join(homeDir, '.codex', 'sessions')
    if (fs.existsSync(codexSessionsDir)) {
      const queue = [codexSessionsDir]
      while (queue.length > 0) {
        const curr = queue.shift()!
        try {
          const entries = fs.readdirSync(curr, { withFileTypes: true })
          for (const entry of entries) {
            const full = path.join(curr, entry.name)
            if (entry.isDirectory()) {
              queue.push(full)
            } else if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.includes(id)) {
              return full
            }
          }
        } catch {}
      }
    }

    // Search in ~/.codex/archived_sessions/
    const archDir = path.join(homeDir, '.codex', 'archived_sessions')
    if (fs.existsSync(archDir)) {
      try {
        const files = fs.readdirSync(archDir)
        for (const f of files) {
          if (f.includes(id) && f.endsWith('.jsonl')) {
            return path.join(archDir, f)
          }
        }
      } catch {}
    }

    return ''
  }

  private formatTitle(row: any): string {
    if (row.name && row.name.trim()) return row.name.trim()
    let raw = row.title || row.first_user_message || row.preview || ''

    // If it contains a transcript wrapper
    if (raw.includes('TRANSCRIPT START')) {
      const match = raw.match(/\[\d+\]\s*user:\s*([\s\S]+?)(?=\n\s*\[\d+\]|\n\s*>>>|$)/)
      if (match && match[1]) {
        raw = match[1].trim()
      }
    }

    // If it contains '## My request:'
    if (raw.includes('## My request:')) {
      const reqMatch = raw.match(/##\s*My request:\s*([\s\S]+?)(?=\n\s*##|\n\s*\[|$)/)
      if (reqMatch && reqMatch[1]) {
        raw = reqMatch[1].trim()
      }
    }

    // Clean up headers, whitespace and multiple newlines
    raw = raw
      .replace(/^#+\s+/gm, '')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (raw.length > 80) {
      raw = raw.slice(0, 80) + '...'
    }

    return raw || `Codex Thread ${row.id.slice(0, 8)}`
  }

  getSessions(): UnifiedSession[] {
    if (!this.isAvailable()) return []
    let db: any
    try {
      db = this.getDb(true)
      const rows = db.prepare(`
        SELECT id, name, rollout_path, created_at, updated_at, created_at_ms, updated_at_ms, cwd, title, first_user_message, model, model_provider, tokens_used, archived, preview
        FROM threads
        WHERE (archived = 0 OR archived IS NULL)
        ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC
      `).all()

      return rows.map((row: any) => {
        const createdAt = row.created_at_ms || (row.created_at * 1000)
        const updatedAt = row.updated_at_ms || (row.updated_at * 1000)
        return {
          id: row.id,
          cli: 'codex',
          category: 'app',
          title: this.formatTitle(row),
          cwd: row.cwd || '',
          createdAt,
          updatedAt,
          model: row.model || row.model_provider,
          cost: row.tokens_used ? (row.tokens_used / 1000000) * 2.5 : undefined,
          status: row.archived ? 'Archived' : 'Active',
          rawLocation: row.rollout_path || this.dbPath,
          extra: {
            rollout_path: row.rollout_path,
            tokens_used: row.tokens_used
          }
        }
      })
    } catch {
      return []
    } finally {
      if (db) db.close()
    }
  }

  getMessages(id: string, session?: UnifiedSession): SessionMessage[] {
    const rolloutPath = this.findRolloutPath(id, session?.extra?.rollout_path)
    const messages: SessionMessage[] = []

    if (rolloutPath && fs.existsSync(rolloutPath)) {
      try {
        const lines = fs.readFileSync(rolloutPath, 'utf-8').split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line)
            const type = parsed.type
            const payload = parsed.payload || {}

            if (type === 'response_item' && payload.type === 'message') {
              const role = payload.role || 'assistant'
              let content = ''
              if (Array.isArray(payload.content)) {
                for (const c of payload.content) {
                  if (c.text || c.input_text || c.output_text) {
                    content += (content ? '\n\n' : '') + (c.text || c.input_text || c.output_text)
                  }
                }
              }
              if (content) {
                messages.push({
                  id: payload.id,
                  role,
                  content,
                  timestamp: parsed.timestamp ? new Date(parsed.timestamp).getTime() : undefined
                })
              }
            } else if (type === 'event_msg') {
              const item = payload.item || {}
              if (item.type === 'UserMessage' && item.content) {
                let text = ''
                for (const c of item.content) {
                  if (c.text) text += (text ? '\n\n' : '') + c.text
                }
                if (text && !messages.some(m => m.content === text)) {
                  messages.push({
                    id: item.id,
                    role: 'user',
                    content: text,
                    timestamp: parsed.timestamp ? new Date(parsed.timestamp).getTime() : undefined
                  })
                }
              } else if (item.type === 'AgentMessage' && item.content) {
                let text = ''
                for (const c of item.content) {
                  if (c.text) text += (text ? '\n\n' : '') + c.text
                }
                if (text && !messages.some(m => m.content === text)) {
                  messages.push({
                    id: item.id,
                    role: 'assistant',
                    content: text,
                    timestamp: parsed.timestamp ? new Date(parsed.timestamp).getTime() : undefined
                  })
                }
              } else if (item.type === 'Reasoning' && item.summary_text?.length) {
                const thought = item.summary_text.join('\n')
                if (messages.length && messages[messages.length - 1].role === 'assistant') {
                  messages[messages.length - 1].thought = thought
                }
              }
            }
          } catch {}
        }
      } catch (e) {
        console.error('Error reading codex rollout jsonl:', e)
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
    let db: any
    try {
      db = this.getDb(false)
      if (payload.title) {
        db.prepare(`UPDATE threads SET title = ?, updated_at_ms = ? WHERE id = ?`).run(payload.title, Date.now(), id)
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
      const nowSec = Math.floor(Date.now() / 1000)
      const nowMs = Date.now()
      db.prepare(`UPDATE threads SET archived = 1, archived_at = ?, updated_at = ?, updated_at_ms = ? WHERE id = ?`).run(nowSec, nowSec, nowMs, id)
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
          INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode, created_at_ms, updated_at_ms)
          VALUES (?, '', ?, ?, 'app', 'openai', ?, ?, 'standard', 'auto', ?, ?)
        `).run(id, Math.floor(now / 1000), Math.floor(now / 1000), targetCwd, payload.title || 'New Codex Thread', now, now)
      } finally {
        if (db) db.close()
      }
    }

    return {
      id,
      cli: 'codex',
      category: 'app',
      title: payload.title || `Codex ${id.slice(0, 8)}`,
      cwd: targetCwd,
      createdAt: now,
      updatedAt: now,
      rawLocation: this.dbPath
    }
  }
}
