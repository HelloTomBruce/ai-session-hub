import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'
import type {
  SessionPlugin,
  SessionPluginManifest,
  UnifiedSession,
  SessionMessage,
  CreateSessionPayload,
  UpdateSessionPayload
} from '@session-hub/core'

interface CodexThreadRow {
  id: string
  title?: string
  name?: string
  first_user_message?: string
  preview?: string
  rollout_path?: string
  created_at?: number
  created_at_ms?: number
  updated_at?: number
  updated_at_ms?: number
  cwd?: string
  model?: string
  model_provider?: string
  tokens_used?: number
  archived?: number
}

export class CodexPlugin implements SessionPlugin {
  readonly manifest: SessionPluginManifest = {
    id: 'codex',
    name: 'Codex App',
    category: 'app',
    icon: 'i-lucide-cpu',
    version: '1.0.0',
    description: 'OpenAI 官方 Codex 桌面客户端，支持沙箱会话与 Rollout 线程跟踪',
    author: 'Session Hub Team',
    type: 'builtin',
    defaultEnabled: true
  }

  /** rollout 路径解析缓存：避免每次拉取消息都对 ~/.codex/sessions 做全目录 BFS */
  private rolloutPathCache = new Map<string, string>()

  private dbPath: string

  constructor(customDbPath?: string) {
    this.dbPath = customDbPath || path.join(os.homedir(), '.codex', 'state_5.sqlite')
  }

  isAvailable(): boolean {
    return fs.existsSync(this.dbPath)
  }

  private getDb(readonly = true): Database.Database {
    return new Database(this.dbPath, { readonly, fileMustExist: true })
  }

  private findRolloutPath(id: string, storedPath?: string): string {
    if (storedPath && fs.existsSync(storedPath)) return storedPath

    // 命中缓存（含负缓存 ''）时直接返回，避免重复 BFS
    const cached = this.rolloutPathCache.get(id)
    if (cached !== undefined) return cached

    const resolved = this.searchRolloutPath(id)
    this.rolloutPathCache.set(id, resolved)
    return resolved
  }

  private searchRolloutPath(id: string): string {
    const homeDir = os.homedir()
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
        } catch {
          // ignore
        }
      }
    }

    const archDir = path.join(homeDir, '.codex', 'archived_sessions')
    if (fs.existsSync(archDir)) {
      try {
        const files = fs.readdirSync(archDir)
        for (const f of files) {
          if (f.includes(id) && f.endsWith('.jsonl')) {
            return path.join(archDir, f)
          }
        }
      } catch {
        // ignore
      }
    }

    return ''
  }

  private formatTitle(row: CodexThreadRow): string {
    if (row.title && row.title.trim()) return row.title.trim()
    if (row.name && row.name.trim()) return row.name.trim()
    let raw = row.first_user_message || row.preview || ''

    if (raw.includes('TRANSCRIPT START')) {
      const match = raw.match(/\[\d+\]\s*user:\s*([\s\S]+?)(?=\n\s*\[\d+\]|\n\s*>>>|$)/)
      if (match && match[1]) {
        raw = match[1].trim()
      }
    }

    if (raw.includes('## My request:')) {
      const reqMatch = raw.match(/##\s*My request:\s*([\s\S]+?)(?=\n\s*##|\n\s*\[|$)/)
      if (reqMatch && reqMatch[1]) {
        raw = reqMatch[1].trim()
      }
    }

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
    let db: Database.Database | undefined
    try {
      db = this.getDb(true)
      const rows = db.prepare(`
        SELECT id, name, rollout_path, created_at, updated_at, created_at_ms, updated_at_ms, cwd, title, first_user_message, model, model_provider, tokens_used, archived, preview
        FROM threads
        WHERE (archived = 0 OR archived IS NULL)
        ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC
      `).all() as CodexThreadRow[]

      return rows.map((row: CodexThreadRow) => {
        const createdAt = row.created_at_ms || (Number(row.created_at) * 1000)
        const updatedAt = row.updated_at_ms || (Number(row.updated_at) * 1000)
        const model = row.model || row.model_provider
        return {
          id: row.id,
          cli: 'codex',
          category: 'app',
          title: this.formatTitle(row),
          cwd: row.cwd || '',
          createdAt,
          updatedAt,
          model,
          cost: this.estimateCost(row.tokens_used, model),
          status: row.archived ? 'Archived' : 'Active',
          rawLocation: row.rollout_path || this.dbPath,
          extra: {
            rollout_path: row.rollout_path,
            tokens_used: row.tokens_used
          }
        }
      })
    } catch (err) {
      console.error('[CodexPlugin] Failed to read sessions (DB schema drifted or file corrupted?):', err)
      return []
    } finally {
      if (db) db.close()
    }
  }

  /**
   * 按模型单价估算成本（tokens_used 为输入+输出总 token，按 3:1 输入输出比折算）。
   * 未知模型返回 undefined，不再输出与模型无关的伪成本。
   * 单价为每百万 token 美元，随官方定价调整。
   */
  private estimateCost(tokensUsed: number | undefined, model: string | undefined): number | undefined {
    if (!tokensUsed || !model) return undefined
    const rates: Record<string, { input: number, output: number }> = {
      'gpt-5': { input: 1.25, output: 10 },
      'gpt-5-codex': { input: 1.25, output: 10 },
      'gpt-5.1': { input: 1.25, output: 10 },
      'gpt-5-mini': { input: 0.25, output: 2 },
      'gpt-5-nano': { input: 0.05, output: 0.4 },
      'codex-mini-latest': { input: 0.15, output: 0.6 },
      'o3': { input: 2, output: 8 },
      'o4-mini': { input: 1.1, output: 4.4 }
    }
    const rate = rates[model]
    if (!rate) return undefined
    const blended = rate.input * 0.75 + rate.output * 0.25
    return (tokensUsed / 1000000) * blended
  }

  /**
   * Codex rollout 中的 role 归一化：developer/system 视角的消息统一为用户侧，
   * 避免泄漏出统一枚举之外的 role 导致前端渲染异常。
   */
  private normalizeRole(role: string | undefined): SessionMessage['role'] {
    switch (role) {
      case 'user':
      case 'developer':
        return 'user'
      case 'assistant':
        return 'assistant'
      case 'system':
        return 'system'
      case 'tool':
        return 'tool'
      default:
        return 'assistant'
    }
  }

  getMessages(id: string, session?: UnifiedSession): SessionMessage[] {
    const rolloutPath = this.findRolloutPath(id, session?.extra?.rollout_path as string | undefined)
    const messages: SessionMessage[] = []

    if (rolloutPath && fs.existsSync(rolloutPath)) {
      try {
        const lines = fs.readFileSync(rolloutPath, 'utf-8').split('\n').filter(Boolean)
        // 基于消息 id 去重：同一事件可能同时以 response_item 与 event_msg 两种形式落盘。
        // 不能用内容去重——用户连续发送相同文本是合法场景，按内容去重会丢消息。
        const seenIds = new Set<string>()
        const isDuplicate = (msgId: string | undefined): boolean => {
          if (!msgId) return false
          if (seenIds.has(msgId)) return true
          seenIds.add(msgId)
          return false
        }

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line)
            const type = parsed.type
            const payload = parsed.payload || {}

            if (type === 'response_item' && payload.type === 'message') {
              const role = this.normalizeRole(payload.role)
              let content = ''
              if (Array.isArray(payload.content)) {
                for (const c of payload.content) {
                  if (c.text || c.input_text || c.output_text) {
                    content += (content ? '\n\n' : '') + (c.text || c.input_text || c.output_text)
                  }
                }
              }
              if (content && !isDuplicate(payload.id)) {
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
                if (text && !isDuplicate(item.id)) {
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
                if (text && !isDuplicate(item.id)) {
                  messages.push({
                    id: item.id,
                    role: 'assistant',
                    content: text,
                    timestamp: parsed.timestamp ? new Date(parsed.timestamp).getTime() : undefined
                  })
                }
              } else if (item.type === 'Reasoning' && item.summary_text?.length) {
                const thought = item.summary_text.join('\n')
                const lastMsg = messages[messages.length - 1]
                if (lastMsg && lastMsg.role === 'assistant') {
                  lastMsg.thought = thought
                }
              }
            }
          } catch {
            // skip malformed
          }
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
    let db: Database.Database | undefined
    try {
      db = this.getDb(false)
      if (payload.title) {
        const res = db.prepare(`UPDATE threads SET title = ?, name = ?, updated_at_ms = ? WHERE id = ?`).run(payload.title, payload.title, Date.now(), id)
        return res.changes > 0
      }
    } catch (e) {
      console.error('[CodexPlugin] Failed updating session:', e)
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
      const nowSec = Math.floor(Date.now() / 1000)
      const nowMs = Date.now()
      db.prepare(`UPDATE threads SET archived = 1, archived_at = ?, updated_at = ?, updated_at_ms = ? WHERE id = ?`).run(nowSec, nowSec, nowMs, id)
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

export const plugin = new CodexPlugin()
export default plugin
