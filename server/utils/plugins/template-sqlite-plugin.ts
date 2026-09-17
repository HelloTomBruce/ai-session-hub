import fs from 'node:fs'
import os from 'node:os'
import Database from 'better-sqlite3'
import type { SessionPlugin, SessionPluginManifest, TemplateSqliteConfig } from '../plugin-types'
import type { UnifiedSession, SessionMessage, CreateSessionPayload, UpdateSessionPayload } from '../types'

export class TemplateSqlitePlugin implements SessionPlugin {
  readonly manifest: SessionPluginManifest
  private dbPath: string

  constructor(private config: TemplateSqliteConfig) {
    this.dbPath = config.dbPath.replace(/^~(?=$|\/|\\)/, os.homedir())
    this.manifest = {
      id: config.id,
      name: config.name,
      category: config.category || 'app',
      icon: config.icon || 'i-lucide-database',
      type: 'template-sqlite',
      description: config.description || `声明式 SQLite 插件 (${config.dbPath})`,
      defaultEnabled: true
    }
  }

  isAvailable(): boolean {
    return fs.existsSync(this.dbPath)
  }

  private getDb(readonly = true): Database.Database | null {
    if (!this.isAvailable()) return null
    try {
      return new Database(this.dbPath, { readonly, fileMustExist: true })
    } catch {
      return null
    }
  }

  getSessions(): UnifiedSession[] {
    const db = this.getDb(true)
    if (!db) return []
    const sessions: UnifiedSession[] = []

    try {
      const idCol = this.config.idColumn || 'id'
      const titleCol = this.config.titleColumn || 'title'
      const updatedCol = this.config.updatedAtColumn || 'updated_at'
      const cwdCol = this.config.cwdColumn || 'cwd'

      const rows = db.prepare(`SELECT * FROM ${this.config.sessionsTable}`).all() as Record<string, unknown>[]

      for (const row of rows) {
        const id = String(row[idCol] || '')
        if (!id) continue
        const title = String(row[titleCol] || `${this.manifest.name} Session ${id.slice(0, 8)}`)
        const updatedAt = Number(row[updatedCol]) || Date.now()
        const cwd = String(row[cwdCol] || os.homedir())

        sessions.push({
          id,
          cli: this.manifest.id,
          category: this.manifest.category,
          title,
          cwd,
          createdAt: updatedAt,
          updatedAt,
          rawLocation: this.dbPath
        })
      }
    } catch (err) {
      console.error(`[TemplateSqlitePlugin] Error reading sessions for ${this.manifest.id}:`, err)
    } finally {
      db.close()
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getMessages(id: string, _session?: UnifiedSession): SessionMessage[] {
    const db = this.getDb(true)
    if (!db || !this.config.messagesTable) return []
    const messages: SessionMessage[] = []

    try {
      const rows = db.prepare(`SELECT * FROM ${this.config.messagesTable} WHERE session_id = ? OR conversation_id = ?`).all(id, id) as Record<string, unknown>[]
      for (const row of rows) {
        const role = (row.role as SessionMessage['role']) || 'user'
        const content = String(row.content || row.text || row.message || '')
        if (content) {
          messages.push({
            role,
            content,
            timestamp: Number(row.timestamp || row.created_at) || undefined
          })
        }
      }
    } catch (err) {
      console.error(`[TemplateSqlitePlugin] Error reading messages for ${this.manifest.id}:`, err)
    } finally {
      db.close()
    }

    return messages
  }

  deleteSession(id: string): boolean {
    const db = this.getDb(false)
    if (!db) return true

    try {
      if (this.config.deleteSql) {
        db.prepare(this.config.deleteSql).run(id)
      } else {
        const idCol = this.config.idColumn || 'id'
        db.prepare(`DELETE FROM ${this.config.sessionsTable} WHERE ${idCol} = ?`).run(id)
      }
    } catch (e) {
      console.warn(`[TemplateSqlitePlugin] Error deleting session ${id}:`, e)
    } finally {
      db.close()
    }

    return true
  }

  updateSession(_id: string, _payload: UpdateSessionPayload): boolean {
    return true
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const now = Date.now()
    const id = `session_${now}`
    return {
      id,
      cli: this.manifest.id,
      category: this.manifest.category,
      title: payload.title || id,
      cwd: payload.cwd || os.homedir(),
      createdAt: now,
      updatedAt: now,
      rawLocation: this.dbPath
    }
  }
}
