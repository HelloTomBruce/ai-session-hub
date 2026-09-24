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

// ---- OpenCode v2 schema (session_v2 + session_message) ----

interface OpenCodeSessionV2Row {
  id: string
  slug?: string
  directory?: string
  path?: string
  title?: string
  cost?: number
  model?: string
  agent?: string
  parent_id?: string
  tokens_input?: number
  tokens_output?: number
  time_created?: number
  time_updated?: number
  summary_files?: number
  summary_additions?: number
  summary_deletions?: number
}

interface OpenCodeSessionMessageRow {
  id: string
  type: string
  seq?: number
  time_created?: number
  data?: string
}

interface OpenCodeV2ContentItem {
  type?: string
  text?: string
  name?: string
  state?: {
    status?: string
    input?: unknown
    content?: Array<{ type?: string, text?: string }>
    metadata?: Record<string, unknown>
  }
  time?: { created?: number }
}

interface OpenCodeV2MessageData {
  text?: string
  summary?: string
  reason?: string
  agent?: string
  model?: { id?: string, providerID?: string }
  time?: { created?: number }
  content?: OpenCodeV2ContentItem[]
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
    type: 'npm',
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

  private isV2Schema(db: Database.Database): boolean {
    try {
      const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_v2'`).get()
      return !!row
    } catch {
      return false
    }
  }

  private parseModel(model: string | undefined): string {
    if (!model) return ''
    // v2 的 model 列为 JSON：{"id":"...","providerID":"..."}
    if (model.startsWith('{')) {
      try {
        const m = JSON.parse(model) as { id?: string }
        return m.id || model
      } catch {
        return model
      }
    }
    return model
  }

  getSessions(): UnifiedSession[] {
    if (!this.isAvailable()) return []
    let db: Database.Database | undefined
    try {
      db = this.getDb(true)
      if (this.isV2Schema(db)) return this.getSessionsV2(db)
      return this.getSessionsLegacy(db)
    } catch {
      return []
    } finally {
      if (db) db.close()
    }
  }

  private getSessionsV2(db: Database.Database): UnifiedSession[] {
    const rows = db.prepare(`
      SELECT id, slug, directory, path, title, cost, model, agent, parent_id,
             tokens_input, tokens_output, time_created, time_updated,
             summary_files, summary_additions, summary_deletions
      FROM session_v2
      ORDER BY time_updated DESC
    `).all() as OpenCodeSessionV2Row[]

    return rows.map(row => ({
      id: row.id,
      cli: 'opencode',
      category: 'cli',
      title: row.title || row.slug || `OpenCode ${row.id.slice(0, 8)}`,
      cwd: row.directory || row.path || '',
      createdAt: row.time_created || Date.now(),
      updatedAt: row.time_updated || Date.now(),
      cost: row.cost,
      model: this.parseModel(row.model),
      rawLocation: this.dbPath,
      extra: {
        agent: row.agent,
        parent_id: row.parent_id,
        tokens_input: row.tokens_input,
        tokens_output: row.tokens_output,
        slug: row.slug,
        summary_files: row.summary_files,
        summary_additions: row.summary_additions,
        summary_deletions: row.summary_deletions
      }
    }))
  }

  private getSessionsLegacy(db: Database.Database): UnifiedSession[] {
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
      model: row.model,
      rawLocation: this.dbPath,
      extra: {
        slug: row.slug,
        summary_files: row.summary_files,
        summary_additions: row.summary_additions,
        summary_deletions: row.summary_deletions
      }
    }))
  }

  getMessages(id: string, _session?: UnifiedSession): SessionMessage[] {
    if (!this.isAvailable()) return []
    let db: Database.Database | undefined
    try {
      db = this.getDb(true)
      if (this.isV2Schema(db)) return this.getMessagesV2(db, id)
      return this.getMessagesLegacy(db, id)
    } finally {
      if (db) db.close()
    }
  }

  private getMessagesV2(db: Database.Database, id: string): SessionMessage[] {
    const messages: SessionMessage[] = []
    const msgs = db.prepare(`
      SELECT id, type, seq, time_created, data
      FROM session_message
      WHERE session_id = ?
      ORDER BY seq ASC
    `).all(id) as OpenCodeSessionMessageRow[]

    for (const m of msgs) {
      let data: Record<string, unknown> = {}
      try {
        data = m.data ? JSON.parse(m.data) as Record<string, unknown> : {}
      } catch {
        // ignore malformed row
      }

      // idle / model-switched / location-switched 是元数据事件，跳过
      if (m.type === 'idle' || m.type === 'model-switched' || m.type === 'location-switched') continue

      if (m.type === 'user' || m.type === 'synthetic') {
        const text = (data.text as string) || ''
        if (text) {
          messages.push({
            id: m.id,
            role: 'user',
            content: text,
            timestamp: (data.time as { created?: number } | undefined)?.created || m.time_created
          })
        }
        continue
      }

      if (m.type === 'system') {
        const text = (data.text as string) || ''
        if (text) {
          messages.push({
            id: m.id,
            role: 'system',
            content: text,
            timestamp: (data.time as { created?: number } | undefined)?.created || m.time_created
          })
        }
        continue
      }

      if (m.type === 'compaction') {
        const summary = (data.summary as string) || ''
        if (summary) {
          messages.push({
            id: m.id,
            role: 'system',
            content: `[上下文压缩${data.reason ? ` · ${String(data.reason)}` : ''}]\n${summary}`,
            timestamp: (data.time as { created?: number } | undefined)?.created || m.time_created
          })
        }
        continue
      }

      if (m.type === 'assistant') {
        const model = (data.model as { id?: string } | undefined)?.id || ''
        let content = ''
        let thought = ''
        const toolCalls: SessionToolCall[] = []

        for (const item of (data.content as OpenCodeV2ContentItem[] | undefined) || []) {
          if (item.type === 'text') {
            if (item.text) content += (content ? '\n\n' : '') + item.text
          } else if (item.type === 'reasoning') {
            if (item.text) thought += (thought ? '\n' : '') + item.text
          } else if (item.type === 'tool') {
            const outputText = (item.state?.content || [])
              .map(c => c.text || '')
              .filter(Boolean)
              .join('\n')
            toolCalls.push({
              name: item.name || 'tool',
              arguments: item.state?.input || {},
              output: outputText || item.state?.status
            })
          }
        }

        if (content || thought || toolCalls.length) {
          messages.push({
            id: m.id,
            role: 'assistant',
            content: content || (thought ? `*(Thinking)*\n${thought}` : ''),
            timestamp: (data.time as { created?: number } | undefined)?.created || m.time_created,
            model,
            thought: thought || undefined,
            toolCalls: toolCalls.length ? toolCalls : undefined
          })
        }
      }
    }

    return messages
  }

  private getMessagesLegacy(db: Database.Database, id: string): SessionMessage[] {
    const messages: SessionMessage[] = []
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

    return messages
  }

  updateSession(id: string, payload: UpdateSessionPayload): boolean {
    if (!this.isAvailable()) return false
    let db: Database.Database | undefined
    try {
      db = this.getDb(false)
      if (payload.title) {
        const now = Date.now()
        const res = this.isV2Schema(db)
          ? db.prepare(`UPDATE session_v2 SET title = ?, time_updated = ? WHERE id = ?`).run(payload.title, now, id)
          : db.prepare(`UPDATE session SET title = ?, time_updated = ? WHERE id = ?`).run(payload.title, now, id)
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
      if (this.isV2Schema(db)) {
        // session_message 通过外键级联删除
        db.prepare(`DELETE FROM session_v2 WHERE id = ?`).run(id)
      } else {
        db.prepare(`DELETE FROM session WHERE id = ?`).run(id)
      }
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
        const row = db.prepare(`SELECT id FROM project WHERE worktree = ? LIMIT 1`).get(targetCwd) as OpenCodeProjectRow | undefined
        const projectId = row?.id || 'global'
        if (this.isV2Schema(db)) {
          db.prepare(`
            INSERT INTO session_v2 (id, project_id, slug, directory, title, version, cost, time_created, time_updated)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
          `).run(id, projectId, id, targetCwd, payload.title || 'New OpenCode Session', '1.0', now, now)
        } else {
          db.prepare(`
            INSERT INTO session (id, project_id, slug, directory, title, version, cost, time_created, time_updated)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
          `).run(id, projectId, id, targetCwd, payload.title || 'New OpenCode Session', '1.0', now, now)
        }
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
