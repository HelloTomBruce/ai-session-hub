import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { SessionPlugin, SessionPluginManifest, TemplateJsonlConfig } from '../plugin-types'
import type { UnifiedSession, SessionMessage, CreateSessionPayload, UpdateSessionPayload } from '../types'

export class TemplateJsonlPlugin implements SessionPlugin {
  readonly manifest: SessionPluginManifest
  private baseDir: string

  constructor(private config: TemplateJsonlConfig) {
    this.baseDir = config.baseDir.replace(/^~(?=$|\/|\\)/, os.homedir())
    this.manifest = {
      id: config.id,
      name: config.name,
      category: config.category || 'cli',
      icon: config.icon || 'i-lucide-file-text',
      type: 'template-jsonl',
      description: config.description || `声明式 JSONL 插件 (${config.baseDir})`,
      defaultEnabled: true
    }
  }

  isAvailable(): boolean {
    return fs.existsSync(this.baseDir)
  }

  getSessions(): UnifiedSession[] {
    if (!this.isAvailable()) return []
    const sessions: UnifiedSession[] = []

    try {
      const scanFiles = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            scanFiles(full)
          } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            try {
              const stat = fs.statSync(full)
              const id = path.basename(entry.name, '.jsonl')
              sessions.push({
                id,
                cli: this.manifest.id,
                category: this.manifest.category,
                title: `${this.manifest.name} Session ${id.slice(0, 8)}`,
                cwd: path.dirname(full),
                createdAt: stat.birthtimeMs || stat.ctimeMs,
                updatedAt: stat.mtimeMs,
                rawLocation: full
              })
            } catch {
              // ignore unreadable file
            }
          }
        }
      }
      scanFiles(this.baseDir)
    } catch (err) {
      console.error(`[TemplateJsonlPlugin] Error scanning ${this.manifest.id}:`, err)
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getMessages(_id: string, session?: UnifiedSession): SessionMessage[] {
    if (!session || !fs.existsSync(session.rawLocation)) return []
    const messages: SessionMessage[] = []

    try {
      const raw = fs.readFileSync(session.rawLocation, 'utf-8')
      const lines = raw.split('\n').filter(Boolean)

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>
          const role = (parsed[this.config.roleField || 'role'] as SessionMessage['role']) || 'user'
          const content = String(parsed[this.config.contentField || 'content'] || parsed.text || parsed.message || '')
          const timestamp = typeof parsed[this.config.timestampField || 'timestamp'] === 'number'
            ? (parsed[this.config.timestampField || 'timestamp'] as number)
            : undefined

          if (content) {
            messages.push({
              role,
              content,
              timestamp
            })
          }
        } catch {
          // ignore unparseable lines
        }
      }
    } catch (err) {
      console.error(`[TemplateJsonlPlugin] Error reading messages for ${this.manifest.id}:`, err)
    }

    return messages
  }

  deleteSession(id: string): boolean {
    const session = this.getSessions().find(s => s.id === id)
    if (session?.rawLocation && fs.existsSync(session.rawLocation)) {
      try {
        fs.unlinkSync(session.rawLocation)
      } catch (e) {
        console.warn(`[TemplateJsonlPlugin] Error deleting file for ${id}:`, e)
      }
    }
    return true
  }

  updateSession(_id: string, _payload: UpdateSessionPayload): boolean {
    return true
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const now = Date.now()
    const id = `session_${now}`
    const filePath = path.join(this.baseDir, `${id}.jsonl`)
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true })
    }
    fs.writeFileSync(filePath, '', 'utf-8')
    return {
      id,
      cli: this.manifest.id,
      category: this.manifest.category,
      title: payload.title || id,
      cwd: payload.cwd || os.homedir(),
      createdAt: now,
      updatedAt: now,
      rawLocation: filePath
    }
  }
}
