import fs from 'node:fs'
import path from 'node:path'
import type { BaseSessionAdapter, CategoryType, CreateSessionPayload, PlatformType, SessionMessage, UnifiedSession, UpdateSessionPayload } from './types'

export interface JsonlAdapterConfig {
  id: PlatformType
  name: string
  category: CategoryType
  baseDir: string
}

export abstract class BaseJsonlAdapter implements BaseSessionAdapter {
  readonly id: PlatformType
  readonly name: string
  readonly category: CategoryType
  protected baseDir: string

  constructor(config: JsonlAdapterConfig) {
    this.id = config.id
    this.name = config.name
    this.category = config.category
    this.baseDir = config.baseDir
  }

  isAvailable(): boolean {
    return fs.existsSync(this.baseDir)
  }

  protected readJsonl(filePath: string): any[] {
    if (!fs.existsSync(filePath)) return []
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      return content.split('\n').filter(Boolean).map(line => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      }).filter(Boolean)
    } catch (e) {
      console.error(`Error reading jsonl at ${filePath}:`, e)
      return []
    }
  }

  deleteSession(id: string): boolean {
    const session = this.getSessions().find(s => s.id === id)
    if (!session || !fs.existsSync(session.rawLocation)) return false

    try {
      fs.unlinkSync(session.rawLocation)
      const dirWithoutExt = session.rawLocation.replace(/\.jsonl$/, '')
      if (fs.existsSync(dirWithoutExt) && fs.statSync(dirWithoutExt).isDirectory()) {
        fs.rmSync(dirWithoutExt, { recursive: true, force: true })
      }
      return true
    } catch {
      return false
    }
  }

  updateSession(id: string, _payload: UpdateSessionPayload): boolean {
    return true
  }

  abstract getSessions(): UnifiedSession[]
  abstract getMessages(id: string, session?: UnifiedSession): SessionMessage[]
  abstract createSession(payload: CreateSessionPayload): UnifiedSession
}
