import fs from 'node:fs'
import Database from 'better-sqlite3'
import type { BaseSessionAdapter, CategoryType, CreateSessionPayload, PlatformType, SessionMessage, UnifiedSession, UpdateSessionPayload } from './types'

export interface SqliteAdapterConfig {
  id: PlatformType
  name: string
  category: CategoryType
  dbPath: string
}

export abstract class BaseSqliteAdapter implements BaseSessionAdapter {
  readonly id: PlatformType
  readonly name: string
  readonly category: CategoryType
  protected dbPath: string

  constructor(config: SqliteAdapterConfig) {
    this.id = config.id
    this.name = config.name
    this.category = config.category
    this.dbPath = config.dbPath
  }

  isAvailable(): boolean {
    return fs.existsSync(this.dbPath)
  }

  protected getDb(readonly = true): any {
    return new Database(this.dbPath, { readonly, fileMustExist: true })
  }

  abstract getSessions(): UnifiedSession[]
  abstract getMessages(id: string, session?: UnifiedSession): SessionMessage[]
  abstract updateSession(id: string, payload: UpdateSessionPayload): boolean
  abstract deleteSession(id: string): boolean
  abstract createSession(payload: CreateSessionPayload): UnifiedSession
}
