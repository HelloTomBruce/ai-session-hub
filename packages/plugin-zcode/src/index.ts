import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'
import type {
  SessionPlugin,
  SessionPluginManifest,
  UnifiedSession,
  SessionMessage,
  SessionToolCall,
  CreateSessionPayload,
  UpdateSessionPayload
} from '@session-hub/core'

interface ZCodeSessionRow {
  id: string
  project_id?: string
  workspace_id?: string
  parent_id?: string
  slug?: string
  directory?: string
  path?: string
  title?: string
  time_created?: number
  time_updated?: number
  task_type?: string
  summary_files?: number
  summary_additions?: number
  summary_deletions?: number
  model?: string
  mode?: string
  task_status?: string
  tokens_input?: number
  tokens_output?: number
}

interface ZCodeMessageData {
  role?: 'user' | 'assistant' | 'system'
  modelId?: string
  providerId?: string
  modelSelection?: { providerId?: string, modelId?: string }
  mode?: string
  agent?: string
  time?: { created?: number, completed?: number }
}

interface ZCodeMessageRow {
  id: string
  session_id: string
  time_created?: number
  time_updated?: number
  data?: string | ZCodeMessageData
  sequence?: number
}

interface ZCodePartData {
  type?: string
  text?: string
  callID?: string
  tool?: string
  state?: {
    status?: string
    input?: unknown
    output?: unknown
    title?: string
    metadata?: Record<string, unknown>
  }
  tokens?: {
    total?: number
    input?: number
    output?: number
    reasoning?: number
    cache?: { read?: number, write?: number }
  }
  time?: { start?: number, end?: number }
}

interface ZCodePartRow {
  id: string
  message_id: string
  session_id: string
  time_created?: number
  time_updated?: number
  data?: string | ZCodePartData
  sequence?: number
}

export class ZCodePlugin implements SessionPlugin {
  readonly manifest: SessionPluginManifest = {
    id: 'zcode',
    name: 'ZCode',
    category: 'app',
    icon: 'i-lucide-code-2',
    version: '1.0.0',
    description: 'ZCode 智能编码桌面端与 CLI，支持智能体规划、多模型调用与任务追踪',
    author: 'Session Hub Team',
    type: 'npm',
    defaultEnabled: true
  }

  private dbPath: string
  private tasksDbPath: string

  constructor(customDbPath?: string, customTasksDbPath?: string) {
    this.dbPath = customDbPath || path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite')
    this.tasksDbPath = customTasksDbPath || path.join(os.homedir(), '.zcode', 'v2', 'tasks-index.sqlite')
  }

  isAvailable(): boolean {
    try {
      return fs.existsSync(this.dbPath)
    } catch {
      return false
    }
  }

  private getDb(readonly = true): Database.Database {
    return new Database(this.dbPath, { readonly, fileMustExist: true })
  }

  getSessions(): UnifiedSession[] {
    if (!this.isAvailable()) return []
    let db: Database.Database | undefined
    try {
      db = this.getDb(true)

      let hasTasksDb = false
      if (fs.existsSync(this.tasksDbPath)) {
        try {
          db.prepare(`ATTACH DATABASE ? AS v2`).run(this.tasksDbPath)
          hasTasksDb = true
        } catch {
          hasTasksDb = false
        }
      }

      let rows: ZCodeSessionRow[] = []
      if (hasTasksDb) {
        rows = db.prepare(`
          SELECT
            s.id, s.project_id, s.workspace_id, s.parent_id, s.slug, s.directory, s.path,
            s.title, s.time_created, s.time_updated, s.task_type,
            s.summary_files, s.summary_additions, s.summary_deletions,
            COALESCE(t.model, m.model_id) AS model,
            t.mode AS mode,
            t.task_status AS task_status,
            m.in_tok AS tokens_input,
            m.out_tok AS tokens_output
          FROM session s
          LEFT JOIN (
            SELECT session_id, model_id, SUM(input_tokens) AS in_tok, SUM(output_tokens) AS out_tok
            FROM model_usage
            GROUP BY session_id
          ) m ON s.id = m.session_id
          LEFT JOIN v2.tasks t ON s.id = t.task_id
          ORDER BY s.time_updated DESC
        `).all() as ZCodeSessionRow[]
      } else {
        rows = db.prepare(`
          SELECT
            s.id, s.project_id, s.workspace_id, s.parent_id, s.slug, s.directory, s.path,
            s.title, s.time_created, s.time_updated, s.task_type,
            s.summary_files, s.summary_additions, s.summary_deletions,
            m.model_id AS model,
            m.in_tok AS tokens_input,
            m.out_tok AS tokens_output
          FROM session s
          LEFT JOIN (
            SELECT session_id, model_id, SUM(input_tokens) AS in_tok, SUM(output_tokens) AS out_tok
            FROM model_usage
            GROUP BY session_id
          ) m ON s.id = m.session_id
          ORDER BY s.time_updated DESC
        `).all() as ZCodeSessionRow[]
      }

      return rows.map(row => ({
        id: row.id,
        cli: 'zcode',
        category: 'app',
        title: row.title || row.slug || `ZCode ${row.id.slice(0, 8)}`,
        cwd: row.directory || row.path || '',
        createdAt: row.time_created || Date.now(),
        updatedAt: row.time_updated || Date.now(),
        model: row.model || undefined,
        status: row.task_status || undefined,
        rawLocation: this.dbPath,
        extra: {
          slug: row.slug,
          task_type: row.task_type,
          mode: row.mode,
          tokens_input: row.tokens_input,
          tokens_output: row.tokens_output,
          summary_files: row.summary_files,
          summary_additions: row.summary_additions,
          summary_deletions: row.summary_deletions
        }
      }))
    } catch (e) {
      console.error('[ZCodePlugin] Failed getting sessions:', e)
      return []
    } finally {
      if (db) db.close()
    }
  }

  getMessages(id: string, session?: UnifiedSession): SessionMessage[] {
    if (!this.isAvailable()) return []
    let db: Database.Database | undefined
    try {
      db = this.getDb(true)
      const messages: SessionMessage[] = []

      const msgRows = db.prepare(`
        SELECT id, session_id, time_created, time_updated, data, sequence
        FROM message
        WHERE session_id = ?
        ORDER BY COALESCE(sequence, time_created) ASC
      `).all(id) as ZCodeMessageRow[]

      for (const m of msgRows) {
        let msgData: ZCodeMessageData = {}
        try {
          msgData = typeof m.data === 'string' ? JSON.parse(m.data) as ZCodeMessageData : (m.data || {})
        } catch {
          // ignore malformed data
        }

        const role = msgData.role || 'assistant'
        const model = msgData.modelId || msgData.modelSelection?.modelId || ''

        const partRows = db.prepare(`
          SELECT id, message_id, session_id, time_created, time_updated, data, sequence
          FROM part
          WHERE message_id = ?
          ORDER BY COALESCE(sequence, time_created) ASC
        `).all(m.id) as ZCodePartRow[]

        let content = ''
        let thought = ''
        const toolCalls: SessionToolCall[] = []

        for (const p of partRows) {
          let pData: ZCodePartData = {}
          try {
            pData = typeof p.data === 'string' ? JSON.parse(p.data) as ZCodePartData : (p.data || {})
          } catch {
            // ignore
          }

          const pType = pData.type

          if (pType === 'text') {
            if (pData.text) {
              content += (content ? '\n\n' : '') + pData.text
            }
          } else if (pType === 'reasoning') {
            if (pData.text) {
              thought += (thought ? '\n' : '') + pData.text
            }
          } else if (pType === 'tool') {
            let outputStr = ''
            if (typeof pData.state?.output === 'string') {
              outputStr = pData.state.output
            } else if (pData.state?.output !== undefined && pData.state?.output !== null) {
              outputStr = JSON.stringify(pData.state.output)
            } else {
              outputStr = pData.state?.status || ''
            }

            toolCalls.push({
              id: pData.callID,
              name: pData.tool || 'tool',
              arguments: pData.state?.input || {},
              output: outputStr
            })
          }
        }

        if (content || thought || toolCalls.length > 0) {
          messages.push({
            id: m.id,
            role: role as SessionMessage['role'],
            content: content || (thought ? `*(Thinking)*\n${thought}` : ''),
            timestamp: msgData.time?.created || m.time_created,
            model: model || undefined,
            thought: thought || undefined,
            toolCalls: toolCalls.length ? toolCalls : undefined
          })
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
    } catch (e) {
      console.error('[ZCodePlugin] Failed getting messages:', e)
      return []
    } finally {
      if (db) db.close()
    }
  }

  updateSession(id: string, payload: UpdateSessionPayload): boolean {
    if (!this.isAvailable()) return false
    let db: Database.Database | undefined
    try {
      db = this.getDb(false)
      if (payload.title) {
        const now = Date.now()
        const res = db.prepare(`UPDATE session SET title = ?, time_updated = ? WHERE id = ?`).run(payload.title, now, id)

        // Try updating tasks-index.sqlite as well if present
        if (fs.existsSync(this.tasksDbPath)) {
          try {
            const tasksDb = new Database(this.tasksDbPath)
            tasksDb.prepare(`UPDATE tasks SET title = ?, updated_at = ?, title_overridden = 1 WHERE task_id = ?`).run(payload.title, now, id)
            tasksDb.close()
          } catch {
            // ignore
          }
        }

        return res.changes > 0
      }
    } catch (e) {
      console.error('[ZCodePlugin] Failed updating session:', e)
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
      db.prepare(`DELETE FROM session WHERE id = ?`).run(id)

      if (fs.existsSync(this.tasksDbPath)) {
        try {
          const tasksDb = new Database(this.tasksDbPath)
          tasksDb.prepare(`DELETE FROM tasks WHERE task_id = ?`).run(id)
          tasksDb.close()
        } catch {
          // ignore
        }
      }

      return true
    } catch (e) {
      console.error('[ZCodePlugin] Failed deleting session:', e)
      return false
    } finally {
      if (db) db.close()
    }
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const targetCwd = payload.cwd || os.homedir()
    const now = Date.now()
    const id = `sess_${Math.random().toString(36).substring(2, 10)}-${Math.random().toString(36).substring(2, 6)}-${Date.now()}`
    const title = payload.title || 'New ZCode Session'

    if (this.isAvailable()) {
      let db: Database.Database | undefined
      try {
        db = this.getDb(false)
        db.prepare(`
          INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated, task_type)
          VALUES (?, ?, ?, ?, ?, '1.0.0', ?, ?, 'interactive')
        `).run(id, 'default_project', id, targetCwd, title, now, now)
      } catch (e) {
        console.error('[ZCodePlugin] Failed inserting new session:', e)
      } finally {
        if (db) db.close()
      }
    }

    return {
      id,
      cli: 'zcode',
      category: 'app',
      title,
      cwd: targetCwd,
      createdAt: now,
      updatedAt: now,
      rawLocation: this.dbPath
    }
  }
}

export const plugin = new ZCodePlugin()
export default plugin
