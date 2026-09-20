import fs from 'node:fs'
import os from 'node:os'
import Database from 'better-sqlite3'
import type { SessionPlugin, SessionPluginManifest, TemplateSqliteConfig } from '../plugin-types'
import type { UnifiedSession, SessionMessage, CreateSessionPayload, UpdateSessionPayload } from '../types'

/** SQL 标识符（表名/列名）白名单校验，防止配置注入 */
function assertIdentifier(name: string, kind: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`[TemplateSqlitePlugin] Invalid ${kind} identifier: ${name}`)
  }
}

export class TemplateSqlitePlugin implements SessionPlugin {
  readonly manifest: SessionPluginManifest
  private dbPath: string
  /** 消息表 FK 列名探测缓存（表结构不变则复用） */
  private fkColumnCache = new Map<string, string | null>()

  constructor(private config: TemplateSqliteConfig) {
    if (!config.id || typeof config.id !== 'string') {
      throw new Error('[TemplateSqlitePlugin] config.id is required')
    }
    if (!config.dbPath || typeof config.dbPath !== 'string') {
      throw new Error(`[TemplateSqlitePlugin] config.dbPath is required (plugin ${config.id})`)
    }
    if (!config.sessionsTable || typeof config.sessionsTable !== 'string') {
      throw new Error(`[TemplateSqlitePlugin] config.sessionsTable is required (plugin ${config.id})`)
    }
    assertIdentifier(config.sessionsTable, 'sessionsTable')
    if (config.messagesTable) assertIdentifier(config.messagesTable, 'messagesTable')

    this.dbPath = config.dbPath.replace(/^~(?=$|\/|\\)/, os.homedir())
    this.manifest = {
      id: config.id,
      name: config.name || config.id,
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
    } catch (err) {
      console.error(`[TemplateSqlitePlugin] Failed to open ${this.dbPath}:`, err)
      return null
    }
  }

  /** 读取表的真实列名列表，用于写入前判断哪些可安全填充 */
  private getTableColumns(db: Database.Database, table: string): string[] {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return rows.map(r => r.name)
  }

  /**
   * 解析消息表中外键列名：优先配置 messageSessionIdColumn，
   * 缺省时自动探测常见命名（session_id / conversation_id / thread_id 等）。
   */
  private resolveMessageFkColumn(db: Database.Database): string | null {
    if (!this.config.messagesTable) return null

    const configured = this.config.messageSessionIdColumn
    if (configured) {
      assertIdentifier(configured, 'messageSessionIdColumn')
      return configured
    }

    const cached = this.fkColumnCache.get(this.config.messagesTable)
    if (cached !== undefined) return cached

    let resolved: string | null = null
    try {
      const columns = this.getTableColumns(db, this.config.messagesTable)
      const preferred = ['session_id', 'conversation_id', 'sessionId', 'conversationId', 'thread_id', 'chat_id', 'sessionId']
      resolved = columns.find(c => preferred.includes(c))
        || columns.find(c => /session|conversation|thread|chat/i.test(c))
        || null
    } catch (err) {
      console.error(`[TemplateSqlitePlugin] Failed to inspect messages table ${this.config.messagesTable}:`, err)
    }

    this.fkColumnCache.set(this.config.messagesTable, resolved)
    return resolved
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
      for (const [col, kind] of [[idCol, 'idColumn'], [titleCol, 'titleColumn'], [updatedCol, 'updatedAtColumn'], [cwdCol, 'cwdColumn']] as const) {
        assertIdentifier(col, kind)
      }

      const rows = db.prepare(`SELECT * FROM ${this.config.sessionsTable}`).all() as Record<string, unknown>[]

      for (const row of rows) {
        const id = String(row[idCol] || '')
        if (!id) continue
        const title = String(row[titleCol] || `${this.manifest.name} Session ${id.slice(0, 8)}`)
        const rawUpdated = row[updatedCol]
        // 同时兼容秒级/毫秒级时间戳与 ISO 字符串
        let updatedAt = Number(rawUpdated) || 0
        if (!updatedAt && typeof rawUpdated === 'string') {
          updatedAt = new Date(rawUpdated).getTime() || 0
        }
        if (!updatedAt) updatedAt = Date.now()
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
      assertIdentifier(this.config.messagesTable, 'messagesTable')
      const fkCol = this.resolveMessageFkColumn(db)
      if (!fkCol) {
        console.error(`[TemplateSqlitePlugin] Cannot find session foreign key column in ${this.config.messagesTable} (plugin ${this.manifest.id}). `
          + 'Set "messageSessionIdColumn" in the plugin JSON config.')
        return messages
      }

      const orderCol = this.config.messageOrderColumn
      if (orderCol) assertIdentifier(orderCol, 'messageOrderColumn')
      const orderSql = orderCol ? ` ORDER BY ${orderCol} ASC` : ''
      const rows = db.prepare(`SELECT * FROM ${this.config.messagesTable} WHERE ${fkCol} = ?${orderSql}`).all(id) as Record<string, unknown>[]

      for (const [idx, row] of rows.entries()) {
        const role = (row.role as SessionMessage['role']) || 'user'
        const content = String(row.content || row.text || row.message || '')
        const rawTs = row.timestamp || row.created_at
        const timestamp = typeof rawTs === 'number' ? rawTs : (typeof rawTs === 'string' ? new Date(rawTs).getTime() || undefined : undefined)

        if (content) {
          messages.push({
            id: row.id != null ? String(row.id) : `msg_${idx}`,
            role,
            content,
            timestamp
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
        assertIdentifier(idCol, 'idColumn')
        db.prepare(`DELETE FROM ${this.config.sessionsTable} WHERE ${idCol} = ?`).run(id)
      }
    } catch (e) {
      console.warn(`[TemplateSqlitePlugin] Error deleting session ${id}:`, e)
    } finally {
      db.close()
    }

    return true
  }

  updateSession(id: string, payload: UpdateSessionPayload): boolean {
    if (!payload.title) return false
    const db = this.getDb(false)
    if (!db) return false

    try {
      const idCol = this.config.idColumn || 'id'
      const titleCol = this.config.titleColumn || 'title'
      assertIdentifier(idCol, 'idColumn')
      assertIdentifier(titleCol, 'titleColumn')

      const res = db.prepare(`UPDATE ${this.config.sessionsTable} SET ${titleCol} = ? WHERE ${idCol} = ?`).run(payload.title, id)
      return res.changes > 0
    } catch (e) {
      console.error(`[TemplateSqlitePlugin] Error updating session ${id}:`, e)
      return false
    } finally {
      db.close()
    }
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const now = Date.now()
    const id = `session_${now}`
    const title = payload.title || id
    const cwd = payload.cwd || os.homedir()

    const db = this.getDb(false)
    if (!db) {
      throw new Error(`[TemplateSqlitePlugin] Database not available: ${this.dbPath}`)
    }

    try {
      const idCol = this.config.idColumn || 'id'
      const titleCol = this.config.titleColumn || 'title'
      const updatedCol = this.config.updatedAtColumn || 'updated_at'
      const cwdCol = this.config.cwdColumn || 'cwd'
      for (const [col, kind] of [[idCol, 'idColumn'], [titleCol, 'titleColumn'], [updatedCol, 'updatedAtColumn'], [cwdCol, 'cwdColumn']] as const) {
        assertIdentifier(col, kind)
      }

      const columns = new Set(this.getTableColumns(db, this.config.sessionsTable))
      const fields: string[] = []
      const values: unknown[] = []
      const push = (col: string, val: unknown) => {
        if (columns.has(col)) {
          fields.push(col)
          values.push(val)
        }
      }

      push(idCol, id)
      push(titleCol, title)
      push(updatedCol, now)
      push(cwdCol, cwd)

      if (fields.length === 0) {
        throw new Error(`No writable columns matched in ${this.config.sessionsTable} (checked: ${idCol}, ${titleCol}, ${updatedCol}, ${cwdCol})`)
      }

      db.prepare(`INSERT INTO ${this.config.sessionsTable} (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`).run(...values)
    } catch (e) {
      db.close()
      // 显式抛出，避免调用方误以为创建成功
      throw new Error(`[TemplateSqlitePlugin] Failed to create session in ${this.dbPath}: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
    }
    db.close()

    return {
      id,
      cli: this.manifest.id,
      category: this.manifest.category,
      title,
      cwd,
      createdAt: now,
      updatedAt: now,
      rawLocation: this.dbPath
    }
  }
}
