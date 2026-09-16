import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type Database from 'better-sqlite3'
import { BaseSqliteAdapter } from '../base-sqlite-adapter'
import type { CreateSessionPayload, SessionMessage, SessionToolCall, UnifiedSession, UpdateSessionPayload } from '../types'

const homeDir = os.homedir()

interface AgySummaryRow {
  conversation_id: string
  title?: string
  preview?: string
  step_count?: number
  last_modified_time?: string
  workspace_uris?: string
  status?: string
  agent_name?: string
  last_user_input_time?: string
}

interface AgyTranscriptLine {
  type?: string
  content?: string
  thinking?: string
  tool_calls?: SessionToolCall[]
  step_index?: number
  created_at?: string
}

export class AgySessionAdapter extends BaseSqliteAdapter {
  constructor() {
    super({
      id: 'agy',
      name: 'AGY CLI',
      category: 'cli',
      dbPath: path.join(homeDir, '.gemini', 'antigravity-cli', 'conversation_summaries.db')
    })
  }

  getSessions(): UnifiedSession[] {
    if (!this.isAvailable()) return []
    let db: Database.Database | undefined
    try {
      db = this.getDb(true)
      const rows = db.prepare(`
        SELECT conversation_id, title, preview, step_count, last_modified_time, workspace_uris, status, agent_name, last_user_input_time
        FROM conversation_summaries
        ORDER BY last_modified_time DESC
      `).all() as AgySummaryRow[]

      return rows.map((row) => {
        let createdAt = Date.now()
        let updatedAt = Date.now()
        try {
          if (row.last_user_input_time) createdAt = new Date(row.last_user_input_time).getTime()
          if (row.last_modified_time) updatedAt = new Date(row.last_modified_time).getTime()
        } catch {
          // keep the default timestamps when stored dates are invalid
        }

        let cwd = ''
        try {
          if (row.workspace_uris) {
            const parsed: unknown = JSON.parse(row.workspace_uris)
            cwd = Array.isArray(parsed) ? parsed[0] as string : parsed as string
          }
        } catch {
          cwd = row.workspace_uris || ''
        }

        return {
          id: row.conversation_id,
          cli: 'agy',
          category: 'cli',
          title: row.title || row.preview || `AGY Session ${row.conversation_id.slice(0, 8)}`,
          cwd: cwd || '',
          createdAt,
          updatedAt,
          messageCount: row.step_count || 0,
          status: row.status,
          rawLocation: path.join(homeDir, '.gemini', 'antigravity-cli', 'conversations', `${row.conversation_id}.db`),
          extra: {
            preview: row.preview,
            agentName: row.agent_name
          }
        }
      })
    } catch {
      return []
    } finally {
      if (db) db.close()
    }
  }

  getMessages(id: string): SessionMessage[] {
    const transcriptPath = path.join(homeDir, '.gemini', 'antigravity-cli', 'brain', id, '.system_generated', 'logs', 'transcript.jsonl')
    const messages: SessionMessage[] = []
    if (fs.existsSync(transcriptPath)) {
      try {
        const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n').filter(Boolean)
        for (const line of lines) {
          const parsed = JSON.parse(line) as AgyTranscriptLine
          const role = parsed.type === 'USER_INPUT' ? 'user' : 'assistant'
          messages.push({
            id: String(parsed.step_index),
            role,
            content: parsed.content || '',
            timestamp: parsed.created_at ? new Date(parsed.created_at).getTime() : undefined,
            thought: parsed.thinking,
            toolCalls: parsed.tool_calls
          })
        }
      } catch {
        // return whatever transcript lines were parsed before the failure
      }
    }
    return messages
  }

  updateSession(id: string, payload: UpdateSessionPayload): boolean {
    if (!this.isAvailable()) return false
    let db: Database.Database | undefined
    try {
      db = this.getDb(false)
      if (payload.title) {
        const res = db.prepare(`UPDATE conversation_summaries SET title = ? WHERE conversation_id = ?`).run(payload.title, id)
        return res.changes > 0
      }
    } catch (e) {
      console.error('[AgySessionAdapter] Failed updating session:', e)
    } finally {
      if (db) db.close()
    }
    return false
  }

  deleteSession(id: string): boolean {
    if (this.isAvailable()) {
      let db: Database.Database | undefined
      try {
        db = this.getDb(false)
        db.prepare(`DELETE FROM conversation_summaries WHERE conversation_id = ?`).run(id)
      } finally {
        if (db) db.close()
      }
    }
    const convDb = path.join(homeDir, '.gemini', 'antigravity-cli', 'conversations', `${id}.db`)
    if (fs.existsSync(convDb)) fs.unlinkSync(convDb)
    const brainDir = path.join(homeDir, '.gemini', 'antigravity-cli', 'brain', id)
    if (fs.existsSync(brainDir)) fs.rmSync(brainDir, { recursive: true, force: true })
    return true
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const targetCwd = payload.cwd || homeDir
    const now = Date.now()
    const id = `session_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`

    if (this.isAvailable()) {
      let db: Database.Database | undefined
      try {
        db = this.getDb(false)
        db.prepare(`
          INSERT OR REPLACE INTO conversation_summaries (conversation_id, title, preview, step_count, last_modified_time, workspace_uris, last_user_input_time)
          VALUES (?, ?, ?, ?, datetime('now'), ?, datetime('now'))
        `).run(id, payload.title || 'New AGY Conversation', payload.initialPrompt || '', payload.initialPrompt ? 1 : 0, JSON.stringify([targetCwd]))
      } finally {
        if (db) db.close()
      }
    }

    return {
      id,
      cli: 'agy',
      category: 'cli',
      title: payload.title || `AGY Session ${id.slice(0, 8)}`,
      cwd: targetCwd,
      createdAt: now,
      updatedAt: now,
      rawLocation: path.join(homeDir, '.gemini', 'antigravity-cli', 'conversations', `${id}.db`)
    }
  }
}
