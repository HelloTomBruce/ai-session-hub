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

export class AgyPlugin implements SessionPlugin {
  readonly manifest: SessionPluginManifest = {
    id: 'agy',
    name: 'AGY CLI',
    category: 'cli',
    icon: 'i-lucide-sparkles',
    version: '1.0.0',
    description: 'Google Antigravity CLI 智能助手，支持项目级脑图与 Transcript 思考链提取',
    author: 'Session Hub Team',
    type: 'builtin',
    defaultEnabled: true
  }

  private dbPath: string

  constructor(customDbPath?: string) {
    this.dbPath = customDbPath || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversation_summaries.db')
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
          // ignore
        }

        let cwd = ''
        try {
          if (row.workspace_uris) {
            const parsed: unknown = JSON.parse(row.workspace_uris)
            cwd = Array.isArray(parsed) ? (parsed[0] as string) : (parsed as string)
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
          rawLocation: path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversations', `${row.conversation_id}.db`),
          extra: {
            preview: row.preview,
            agentName: row.agent_name
          }
        }
      })
    } catch (err) {
      console.error('[AgyPlugin] Failed to read sessions (DB schema drifted or file corrupted?):', err)
      return []
    } finally {
      if (db) db.close()
    }
  }

  getMessages(id: string, _session?: UnifiedSession): SessionMessage[] {
    const transcriptPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain', id, '.system_generated', 'logs', 'transcript.jsonl')
    const messages: SessionMessage[] = []
    if (fs.existsSync(transcriptPath)) {
      let lines: string[]
      try {
        lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n').filter(Boolean)
      } catch (err) {
        console.error(`[AgyPlugin] Failed to read transcript for ${id}:`, err)
        return messages
      }

      // 行级容错：单行坏数据只跳过该行并记录日志，不再中断整个 transcript
      let skippedLines = 0
      for (const [lineIdx, line] of lines.entries()) {
        let parsed: AgyTranscriptLine
        try {
          parsed = JSON.parse(line) as AgyTranscriptLine
        } catch {
          skippedLines++
          continue
        }

        const role = parsed.type === 'USER_INPUT' ? 'user' : 'assistant'
        messages.push({
          // step_index 可能缺失或重复，拼接行号保证消息 id 唯一，避免缓存层主键冲突折叠消息
          id: parsed.step_index != null ? `step_${parsed.step_index}_l${lineIdx}` : `line_${lineIdx}`,
          role,
          content: parsed.content || '',
          timestamp: parsed.created_at ? new Date(parsed.created_at).getTime() : undefined,
          thought: parsed.thinking,
          toolCalls: parsed.tool_calls
        })
      }

      if (skippedLines > 0) {
        console.warn(`[AgyPlugin] Skipped ${skippedLines} malformed line(s) in transcript for ${id}`)
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
      console.error('[AgyPlugin] Failed updating session:', e)
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
      } catch (err) {
        console.error('[AgyPlugin] Failed deleting session from summaries DB:', err)
      } finally {
        if (db) db.close()
      }
    }
    const convDb = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversations', `${id}.db`)
    if (fs.existsSync(convDb)) fs.unlinkSync(convDb)
    const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain', id)
    if (fs.existsSync(brainDir)) fs.rmSync(brainDir, { recursive: true, force: true })
    return true
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const targetCwd = payload.cwd || os.homedir()
    const now = Date.now()
    const id = `session_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`

    if (this.isAvailable()) {
      let db: Database.Database | undefined
      try {
        db = this.getDb(false)
        // 使用带时区的 ISO 字符串而不是 datetime('now')（无时区 UTC 文本会被读取端按本地时区解析，造成 8 小时偏移）
        const nowIso = new Date().toISOString()
        db.prepare(`
          INSERT OR REPLACE INTO conversation_summaries (conversation_id, title, preview, step_count, last_modified_time, workspace_uris, last_user_input_time)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, payload.title || 'New AGY Conversation', payload.initialPrompt || '', payload.initialPrompt ? 1 : 0, nowIso, JSON.stringify([targetCwd]), nowIso)
      } catch (e) {
        console.error('[AgyPlugin] Failed creating session:', e)
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
      rawLocation: path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversations', `${id}.db`)
    }
  }
}

export const plugin = new AgyPlugin()
export default plugin
