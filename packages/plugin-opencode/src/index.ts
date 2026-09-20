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

interface OpenCodeSessionRow {
  id: string
  slug?: string
  directory?: string
  path?: string
  title?: string
  cost?: number
  model?: string
  time_created?: number
  time_updated?: number
  summary_files?: number
  summary_additions?: number
  summary_deletions?: number
}

interface OpenCodeMessageData {
  role?: string
  modelID?: string
  model?: { modelID?: string }
  time?: { created?: number }
}

interface OpenCodeMessageRow {
  id: string
  time_created?: number
  data?: string | OpenCodeMessageData
}

interface OpenCodePartData {
  type?: string
  text?: string
  content?: string
  tool?: string
  name?: string
  input?: unknown
  args?: unknown
  arguments?: unknown
  output?: unknown
  state?: { input?: unknown, output?: unknown }
}

interface OpenCodePartRow {
  id: string
  type?: string
  data?: string | OpenCodePartData
}

interface OpenCodeProjectRow {
  id?: string
}

export class OpenCodePlugin implements SessionPlugin {
  readonly manifest: SessionPluginManifest = {
    id: 'opencode',
    name: 'OpenCode CLI',
    category: 'cli',
    icon: 'i-lucide-code-2',
    version: '1.0.0',
    description: '开源 AI 编码 CLI，支持代码重构、工具调用与多模型对话',
    author: 'Session Hub Team',
    type: 'builtin',
    defaultEnabled: true
  }

  private dbPath: string

  constructor(customDbPath?: string) {
    this.dbPath = customDbPath || path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db')
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
      const rows = db.prepare(`
        SELECT id, slug, directory, path, title, cost, model, time_created, time_updated, summary_files, summary_additions, summary_deletions
        FROM session
        ORDER BY time_updated DESC
      `).all() as OpenCodeSessionRow[]

      return rows.map(row => ({
        id: row.id,
        cli: 'opencode',
        category: 'cli',
        title: row.title || row.slug || `OpenCode ${row.id.slice(0, 8)}`,
        cwd: row.directory || row.path || '',
        createdAt: row.time_created || Date.now(),
        updatedAt: row.time_updated || Date.now(),
        cost: row.cost,
        model: this.extractModelName(row.model),
        rawLocation: this.dbPath,
        extra: {
          slug: row.slug,
          summary_files: row.summary_files,
          summary_additions: row.summary_additions,
          summary_deletions: row.summary_deletions
        }
      }))
    } catch (err) {
      console.error('[OpenCodePlugin] Failed to read sessions (DB schema drifted or file corrupted?):', err)
      return []
    } finally {
      if (db) db.close()
    }
  }

  /**
   * OpenCode 的 model 字段存储的是 JSON 字符串（如 {"id":"...","modelID":"..."}），
   * 需要提取出真实模型名，避免把整段 JSON 透传到 UI。
   */
  private extractModelName(raw: string | undefined): string | undefined {
    if (!raw) return undefined
    const trimmed = raw.trim()
    if (!trimmed.startsWith('{')) return trimmed
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const candidate = parsed.modelID || parsed.id || parsed.model
      return typeof candidate === 'string' && candidate ? candidate : undefined
    } catch {
      return undefined
    }
  }

  getMessages(id: string, _session?: UnifiedSession): SessionMessage[] {
    if (!this.isAvailable()) return []
    let db: Database.Database | undefined
    const messages: SessionMessage[] = []
    try {
      db = this.getDb(true)
      const msgs = db.prepare(`SELECT * FROM message WHERE session_id = ? ORDER BY time_created ASC`).all(id) as OpenCodeMessageRow[]
      for (const m of msgs) {
        let msgData: OpenCodeMessageData = {}
        try {
          msgData = typeof m.data === 'string' ? JSON.parse(m.data) as OpenCodeMessageData : (m.data || {})
        } catch {
          // ignore
        }

        const role = msgData.role || 'assistant'
        const model = msgData.model?.modelID || msgData.modelID || ''

        const parts = db.prepare(`SELECT * FROM part WHERE message_id = ? ORDER BY id ASC`).all(m.id) as OpenCodePartRow[]
        let content = ''
        let thought = ''
        const toolCalls: SessionToolCall[] = []

        for (const p of parts) {
          let pData: OpenCodePartData = {}
          try {
            pData = typeof p.data === 'string' ? JSON.parse(p.data) as OpenCodePartData : (p.data || {})
          } catch {
            // ignore
          }

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
            role: role as SessionMessage['role'],
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
    let db: Database.Database | undefined
    try {
      db = this.getDb(false)
      if (payload.title) {
        const res = db.prepare(`UPDATE session SET title = ?, time_updated = ? WHERE id = ?`).run(payload.title, Date.now(), id)
        return res.changes > 0
      }
    } catch (e) {
      console.error('[OpenCodePlugin] Failed updating session:', e)
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
      // 级联清理消息与 part，避免孤儿数据残留（库未开启 foreign_keys pragma）
      const tx = db.transaction(() => {
        db!.prepare(`DELETE FROM part WHERE message_id IN (SELECT id FROM message WHERE session_id = ?)`).run(id)
        db!.prepare(`DELETE FROM message WHERE session_id = ?`).run(id)
        db!.prepare(`DELETE FROM session WHERE id = ?`).run(id)
      })
      tx()
      return true
    } catch (e) {
      console.error('[OpenCodePlugin] Failed deleting session:', e)
      return false
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
        const row = db.prepare(`SELECT id FROM project WHERE worktree = ? LIMIT 1`).get(targetCwd) as OpenCodeProjectRow | undefined
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

export const plugin = new OpenCodePlugin()
export default plugin
