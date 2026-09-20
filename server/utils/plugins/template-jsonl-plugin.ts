import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { SessionPlugin, SessionPluginManifest, TemplateJsonlConfig } from '../plugin-types'
import type { UnifiedSession, SessionMessage, CreateSessionPayload, UpdateSessionPayload } from '../types'

/** 将简易 glob（支持 * 与 ?）转换为正则；默认匹配所有 .jsonl 文件 */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/\?/g, '[^/\\\\]')
  return new RegExp(`^${escaped}$`)
}

/** 标题元数据行的 type 标识：updateSession 写入，getSessions 读取 */
const TITLE_LINE_TYPE = 'custom_title'

export class TemplateJsonlPlugin implements SessionPlugin {
  readonly manifest: SessionPluginManifest
  private baseDir: string
  private filePatternRegex: RegExp

  constructor(private config: TemplateJsonlConfig) {
    if (!config.id || typeof config.id !== 'string') {
      throw new Error('[TemplateJsonlPlugin] config.id is required')
    }
    if (!config.baseDir || typeof config.baseDir !== 'string') {
      throw new Error(`[TemplateJsonlPlugin] config.baseDir is required (plugin ${config.id})`)
    }

    this.baseDir = config.baseDir.replace(/^~(?=$|\/|\\)/, os.homedir())
    this.filePatternRegex = globToRegex(config.filePattern || '*.jsonl')
    this.manifest = {
      id: config.id,
      name: config.name || config.id,
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

  /** 从文件首行提取标题：优先 titleField 配置，其次 custom_title 元数据行 */
  private extractTitle(filePath: string, fallback: string): string {
    let handle: number | undefined
    try {
      handle = fs.openSync(filePath, 'r')
      const buffer = Buffer.alloc(16384)
      const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0)
      const head = buffer.toString('utf-8', 0, bytesRead)
      const firstLines = head.split('\n').filter(Boolean).slice(0, 5)

      for (const line of firstLines) {
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(line) as Record<string, unknown>
        } catch {
          continue
        }

        if (this.config.titleField) {
          const val = parsed[this.config.titleField]
          if (typeof val === 'string' && val.trim()) return val.trim()
        }

        if (parsed.type === TITLE_LINE_TYPE && typeof parsed.title === 'string' && parsed.title.trim()) {
          return parsed.title.trim()
        }
      }
    } catch {
      // 读取失败时回退默认标题
    } finally {
      if (handle !== undefined) {
        try {
          fs.closeSync(handle)
        } catch {
          /* ignore */
        }
      }
    }
    return fallback
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
          } else if (entry.isFile() && this.filePatternRegex.test(entry.name)) {
            try {
              const stat = fs.statSync(full)
              const id = path.basename(entry.name, path.extname(entry.name))
              sessions.push({
                id,
                cli: this.manifest.id,
                category: this.manifest.category,
                title: this.extractTitle(full, `${this.manifest.name} Session ${id.slice(0, 8)}`),
                cwd: path.dirname(full),
                createdAt: stat.birthtimeMs || stat.ctimeMs,
                updatedAt: stat.mtimeMs,
                rawLocation: full
              })
            } catch (err) {
              console.warn(`[TemplateJsonlPlugin] Skipping unreadable file ${full}:`, err)
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

          // 跳过标题等元数据行
          if (parsed.type === TITLE_LINE_TYPE) continue

          const role = (parsed[this.config.roleField || 'role'] as SessionMessage['role']) || 'user'
          const content = String(parsed[this.config.contentField || 'content'] || parsed.text || parsed.message || '')
          const rawTs = parsed[this.config.timestampField || 'timestamp']
          const timestamp = typeof rawTs === 'number' ? rawTs : (typeof rawTs === 'string' ? new Date(rawTs).getTime() || undefined : undefined)

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

  updateSession(id: string, payload: UpdateSessionPayload): boolean {
    if (!payload.title) return false
    const session = this.getSessions().find(s => s.id === id)
    if (!session?.rawLocation || !fs.existsSync(session.rawLocation)) return false

    try {
      const raw = fs.readFileSync(session.rawLocation, 'utf-8')
      const lines = raw.split('\n').filter(Boolean)
      let titleLineFound = false

      const updatedLines = lines.map((line) => {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>
          if (parsed.type === TITLE_LINE_TYPE) {
            titleLineFound = true
            parsed.title = payload.title
            parsed.updatedAt = Date.now()
            return JSON.stringify(parsed)
          }
        } catch {
          // keep non-json line as-is
        }
        return line
      })

      if (!titleLineFound) {
        updatedLines.unshift(JSON.stringify({
          type: TITLE_LINE_TYPE,
          title: payload.title,
          updatedAt: Date.now()
        }))
      }

      fs.writeFileSync(session.rawLocation, updatedLines.join('\n') + '\n', 'utf-8')
      return true
    } catch (e) {
      console.error(`[TemplateJsonlPlugin] Error updating session ${id}:`, e)
      return false
    }
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const now = Date.now()
    const id = `session_${now}`
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true })
    }

    const lines: string[] = []
    if (payload.title) {
      lines.push(JSON.stringify({ type: TITLE_LINE_TYPE, title: payload.title, updatedAt: now }))
    }
    if (payload.initialPrompt) {
      const msg: Record<string, unknown> = {
        role: 'user',
        [this.config.contentField || 'content']: payload.initialPrompt,
        [this.config.timestampField || 'timestamp']: now
      }
      lines.push(JSON.stringify(msg))
    }

    const filePath = path.join(this.baseDir, `${id}.jsonl`)
    fs.writeFileSync(filePath, lines.length ? lines.join('\n') + '\n' : '', 'utf-8')

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
