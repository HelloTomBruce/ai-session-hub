import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { execSync } from 'node:child_process'
import { decompress as fzstdDecompress } from 'fzstd'
import type {
  SessionPlugin,
  SessionPluginManifest,
  UnifiedSession,
  SessionMessage,
  SessionToolCall,
  UpdateSessionPayload
} from '@session-hub/core'

/**
 * DeepSeek Harness (dsh) 会话插件
 *
 * dsh 将会话以 zstd 压缩的 JSONL 事件流存放在：
 *   ~/.dsh/sessions/<cwd 转义目录>/<sessionId>/session[.vN].jsonl.zstd
 * 同一目录可能并存多个历史版本（session.jsonl.zstd / session.v2 / session.v4），取最新解析。
 * 会话头（type=session）字段在行顶层；其余事件负载在 data 下。
 */

/** 一行事件 */
interface DshEvent {
  type?: string
  seq?: number
  time?: number
  data?: DshEventData
}

interface DshEventData {
  title?: string
  turn?: number
  header?: { config?: { provider?: string, model?: string } }
  provider?: string
  model?: string
  id?: string
  content?: DshBlock[]
  source?: { kind?: string, provider?: string, model?: string }
  message?: DshMessage
}

interface DshMessage {
  role?: string
  content?: DshBlock[]
  toolCallId?: string
  isError?: boolean
}

interface DshBlock {
  type?: string
  text?: string
  id?: string
  name?: string
  arguments?: string
  toolCallId?: string
  content?: DshBlock[]
  isError?: boolean
}

/** 首行 session 头（字段在行顶层而非 data 下） */
interface DshSessionHeader {
  type: 'session'
  version?: number
  id: string
  createdAt?: number
  cwd?: string
  origin?: string
  parentSession?: string
  agentPreset?: string
  delegationDepth?: number
}

interface DshSessionSummary {
  file: string
  logVersion: number
  header: DshSessionHeader
  title: string
  provider?: string
  model?: string
  lastTime: number
  userCount: number
  assistantCount: number
  turns: number
}

const SESSION_FILE_RE = /^session(?:\.v(\d+))?\.jsonl\.zstd$/

/**
 * 解压 dsh 会话日志（zstd 压缩 JSONL）。
 * dsh 以追加式逐帧写入，单个日志是多个 zstd 帧的拼接；
 * fzstd（纯 JS）支持多帧拼接解压，Node 原生 zlib.zstdDecompressSync 只解首帧。
 */
function decompressZstd(buffer: Buffer): string {
  const bytes = fzstdDecompress(new Uint8Array(buffer))
  return Buffer.from(bytes).toString('utf-8')
}

/**
 * 压缩 dsh 会话日志为 zstd。
 * 优先使用 Node 原生 zlib.zstdCompressSync（Node 21.7+），
 * 如不可用则回退至系统 zstd 命令行工具。
 */
function compressZstd(buffer: Buffer): Buffer {
  const api = zlib as unknown as { zstdCompressSync?: (buf: Buffer) => Buffer }
  if (typeof api.zstdCompressSync === 'function') {
    return api.zstdCompressSync(buffer)
  }
  try {
    return execSync('zstd -c', {
      input: buffer,
      stdio: ['pipe', 'pipe', 'ignore'],
      maxBuffer: 100 * 1024 * 1024
    })
  } catch (e) {
    throw new Error(`Failed to compress with zstd: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }
}

/** 拼接 content 块中的文本 */
function extractText(blocks?: DshBlock[]): string {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n\n')
    .trim()
}

/** 解析 tool/result 事件（兼容 v2 / v4 两种结构） */
function parseToolResult(event: DshEvent): { callId: string, text: string, isError: boolean } | null {
  const message = event.data?.message
  if (!message) return null
  // v4+: toolCallId 直接挂在 message 上
  if (message.toolCallId) {
    return {
      callId: message.toolCallId,
      text: extractText(message.content),
      isError: Boolean(message.isError)
    }
  }
  // v2: 包在 content[0] 的 tool-result 块里
  const block = (message.content ?? []).find(item => item.type === 'tool-result')
  if (block?.toolCallId) {
    return {
      callId: block.toolCallId,
      text: extractText(block.content),
      isError: Boolean(block.isError)
    }
  }
  return null
}

export class DshPlugin implements SessionPlugin {
  readonly manifest: SessionPluginManifest = {
    id: 'dsh',
    name: 'DeepSeek Harness',
    category: 'cli',
    icon: 'i-simple-icons-deepseek',
    version: '1.0.0',
    description: 'DeepSeek Harness (dsh) 官方编码 CLI，解析 zstd 压缩 JSONL 事件流会话、思维链与工具调用',
    author: 'Session Hub Team',
    type: 'npm',
    defaultEnabled: true
  }

  private sessionsDir: string

  constructor(customSessionsDir?: string) {
    this.sessionsDir = customSessionsDir || path.join(os.homedir(), '.dsh', 'sessions')
  }

  isAvailable(): boolean {
    try {
      return fs.existsSync(this.sessionsDir)
    } catch {
      return false
    }
  }

  getSessions(): UnifiedSession[] {
    if (!this.isAvailable()) return []
    const sessions: UnifiedSession[] = []
    for (const projectEntry of this.listDirs(this.sessionsDir)) {
      const projectPath = path.join(this.sessionsDir, projectEntry.name)
      for (const sessionEntry of this.listDirs(projectPath)) {
        try {
          const summary = this.parseSessionDir(path.join(projectPath, sessionEntry.name))
          if (summary) sessions.push(this.toUnifiedSession(summary))
        } catch (e) {
          console.error(`[DshPlugin] Failed parsing session ${sessionEntry.name}:`, e)
        }
      }
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getMessages(id: string, session?: UnifiedSession): SessionMessage[] {
    if (!this.isAvailable()) return []
    const dir = this.locateSessionDir(id)
    if (!dir) {
      return session
        ? [{ role: 'user', content: session.title, timestamp: session.createdAt }]
        : []
    }
    const found = this.findSessionFile(dir)
    if (!found) return []
    const events = this.readEvents(found.file)

    // 先按 callId 收集工具结果，再挂回 assistant 消息的 toolCalls
    const toolResults = new Map<string, { text: string, isError: boolean }>()
    for (const event of events) {
      if (event.type !== 'tool/result') continue
      const result = parseToolResult(event)
      if (result) toolResults.set(result.callId, { text: result.text, isError: result.isError })
    }

    const messages: SessionMessage[] = []
    for (const event of events) {
      if (event.type === 'user/message') {
        // 只保留真人输入；runtime-context / skill-catalog / plugin 注入的快照跳过
        if (event.data?.source?.kind !== 'user') continue
        const text = extractText(event.data.content)
        if (!text) continue
        messages.push({
          id: event.data.id,
          role: 'user',
          content: text,
          timestamp: event.time
        })
      } else if (event.type === 'system/message') {
        const text = extractText(event.data?.message?.content)
        if (text) {
          messages.push({ role: 'system', content: text, timestamp: event.time })
        }
      } else if (event.type === 'assistant/message') {
        const message = event.data?.message
        if (!message) continue
        const blocks = message.content ?? []
        const textParts: string[] = []
        const thoughtParts: string[] = []
        const toolCalls: SessionToolCall[] = []
        for (const block of blocks) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text)
          } else if (block.type === 'reasoning' && block.text) {
            thoughtParts.push(block.text)
          } else if (block.type === 'tool-call' && block.name) {
            let args: unknown = block.arguments
            if (typeof block.arguments === 'string') {
              try {
                args = JSON.parse(block.arguments)
              } catch {
                // 保留原始字符串
              }
            }
            const result = block.id ? toolResults.get(block.id) : undefined
            toolCalls.push({
              id: block.id,
              name: block.name,
              arguments: args,
              output: result?.text ?? ''
            })
          }
        }
        const content = textParts.join('\n\n')
        const thought = thoughtParts.join('\n')
        if (!content && !thought && toolCalls.length === 0) continue
        messages.push({
          id: event.seq !== undefined ? `seq-${event.seq}` : undefined,
          role: 'assistant',
          content: content || (thought ? `*(Thinking)*\n${thought}` : ''),
          timestamp: event.time,
          model: event.data?.source?.model,
          thought: thought || undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined
        })
      }
    }
    return messages
  }

  private listDirs(target: string): fs.Dirent[] {
    try {
      return fs.readdirSync(target, { withFileTypes: true }).filter(entry => entry.isDirectory())
    } catch {
      return []
    }
  }

  /** 在会话目录下挑选最新版本的日志文件（session.v4 > session.v2 > session.jsonl） */
  private findSessionFile(dir: string): { file: string, version: number } | null {
    let best: { file: string, version: number } | null = null
    for (const name of fs.readdirSync(dir)) {
      const match = SESSION_FILE_RE.exec(name)
      if (!match) continue
      const version = match[1] ? Number.parseInt(match[1], 10) : 0
      if (!best || version > best.version) {
        best = { file: path.join(dir, name), version }
      }
    }
    return best
  }

  private readEvents(file: string): DshEvent[] {
    const compressed = fs.readFileSync(file)
    const text = decompressZstd(compressed)
    const events: DshEvent[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        events.push(JSON.parse(trimmed) as DshEvent)
      } catch {
        // 跳过损坏行
      }
    }
    return events
  }

  private parseSessionDir(dir: string): DshSessionSummary | null {
    const found = this.findSessionFile(dir)
    if (!found) return null
    const events = this.readEvents(found.file)

    // SAFETY: session 头事件的字段在行顶层而非 data 下，与 DshEvent 结构不同，运行时以 type === 'session' 判定
    const headerEvent = events.find(event => event.type === 'session') as unknown as DshSessionHeader | undefined
    if (!headerEvent || !headerEvent.id) return null

    let title = ''
    let provider: string | undefined
    let model: string | undefined
    let firstUserText = ''
    let lastTime = headerEvent.createdAt ?? 0
    let userCount = 0
    let assistantCount = 0
    let turns = 0

    for (const event of events) {
      if (event.time && event.time > lastTime) lastTime = event.time
      switch (event.type) {
        case 'session/title':
          if (event.data?.title) title = event.data.title
          break
        case 'request/header': {
          const config = event.data?.header?.config
          if (config?.model) {
            model = config.model
            provider = config.provider
          }
          break
        }
        case 'request/context':
          if (!model && event.data?.model) {
            model = event.data.model
            provider = event.data.provider
          }
          break
        case 'turn/start':
          if (event.data?.turn && event.data.turn > turns) turns = event.data.turn
          break
        case 'user/message':
          if (event.data?.source?.kind === 'user') {
            userCount++
            if (!firstUserText) firstUserText = extractText(event.data.content)
          }
          break
        case 'assistant/message':
          assistantCount++
          break
      }
    }

    if (!title) {
      const fallback = firstUserText.replace(/\s+/g, ' ').trim()
      const shortId = headerEvent.id.replace(/^session-/, '').slice(0, 8)
      if (fallback.length > 60) {
        title = `${fallback.slice(0, 60)}…`
      } else if (fallback) {
        title = fallback
      } else {
        title = `DSH 会话 ${shortId}`
      }
    }

    if (!lastTime) {
      try {
        lastTime = Math.round(fs.statSync(found.file).mtimeMs)
      } catch {
        lastTime = Date.now()
      }
    }

    return {
      file: found.file,
      logVersion: found.version,
      header: headerEvent,
      title,
      provider,
      model,
      lastTime,
      userCount,
      assistantCount,
      turns
    }
  }

  private toUnifiedSession(summary: DshSessionSummary): UnifiedSession {
    const { header } = summary
    return {
      id: header.id,
      cli: 'dsh',
      category: 'cli',
      title: summary.title,
      cwd: header.cwd ?? '',
      createdAt: header.createdAt ?? summary.lastTime,
      updatedAt: summary.lastTime,
      messageCount: summary.userCount + summary.assistantCount,
      model: summary.model,
      rawLocation: summary.file,
      extra: {
        provider: summary.provider,
        agent_preset: header.agentPreset,
        origin: header.origin,
        parent_session: header.parentSession,
        delegation_depth: header.delegationDepth,
        log_version: summary.logVersion,
        header_version: header.version,
        turns: summary.turns
      }
    }
  }

  /**
   * 重命名/更新会话标题：
   * 在对应的 session[.vN].jsonl.zstd 文件中更新或插入 session/title 事件，并重新 zstd 压缩保存。
   */
  updateSession(id: string, payload: UpdateSessionPayload): boolean {
    const newTitle = payload.title?.trim()
    if (!newTitle) return false
    const dir = this.locateSessionDir(id)
    if (!dir) return false
    const found = this.findSessionFile(dir)
    if (!found) return false

    try {
      const compressed = fs.readFileSync(found.file)
      const text = decompressZstd(compressed)
      const lines = text.split('\n')
      let titleFound = false

      const updatedLines = lines.map((line) => {
        const trimmed = line.trim()
        if (!trimmed) return line
        try {
          const parsed = JSON.parse(trimmed) as DshEvent
          if (parsed.type === 'session/title') {
            titleFound = true
            if (!parsed.data) parsed.data = {}
            parsed.data.title = newTitle
            parsed.time = Date.now()
            if (!parsed.data.source) parsed.data.source = {}
            parsed.data.source.kind = 'custom'
            return JSON.stringify(parsed)
          }
        } catch {
          // ignore non-json line
        }
        return line
      })

      if (!titleFound) {
        let maxSeq = 0
        for (const line of lines) {
          try {
            const p = JSON.parse(line) as DshEvent
            if (typeof p.seq === 'number' && p.seq > maxSeq) {
              maxSeq = p.seq
            }
          } catch {
            // ignore
          }
        }
        const newTitleEvent: DshEvent = {
          type: 'session/title',
          seq: maxSeq + 1,
          time: Date.now(),
          data: {
            title: newTitle,
            source: { kind: 'custom' }
          }
        }
        // 插在首行 session 头之后，若无则追加到末尾
        const insertIdx = updatedLines.findIndex((l) => {
          try {
            return (JSON.parse(l) as DshEvent).type === 'session'
          } catch {
            return false
          }
        })
        if (insertIdx !== -1) {
          updatedLines.splice(insertIdx + 1, 0, JSON.stringify(newTitleEvent))
        } else {
          updatedLines.push(JSON.stringify(newTitleEvent))
        }
      }

      const updatedContent = updatedLines.filter(line => line.trim().length > 0).join('\n') + '\n'
      const recompressed = compressZstd(Buffer.from(updatedContent, 'utf-8'))
      const tmpFile = `${found.file}.tmp.${Date.now()}`
      fs.writeFileSync(tmpFile, recompressed)
      fs.renameSync(tmpFile, found.file)
      return true
    } catch (e) {
      console.error(`[DshPlugin] Failed updating session ${id}:`, e)
      return false
    }
  }

  /**
   * 删除会话：整个会话目录（含 session.jsonl.zstd / session.vN.jsonl.zstd 多版本文件）一并移除，
   * 否则残留旧版本文件仍会被 getSessions 扫描出来，造成“删除后列表还在”。
   */
  deleteSession(id: string): boolean {
    const dir = this.locateSessionDir(id)
    if (!dir) return true
    // 防呆：只允许删除 sessionsDir 下的会话目录，避免越界删除
    const root = path.resolve(this.sessionsDir)
    const target = path.resolve(dir)
    if (target === root || !target.startsWith(root + path.sep)) return false
    try {
      fs.rmSync(target, { recursive: true, force: true })
      return true
    } catch (e) {
      console.error(`[DshPlugin] Failed deleting session ${id}:`, e)
      return false
    }
  }

  /** 定位会话目录：目录名与 id 一致（兼容 `session-<uuid>` 前缀差异） */
  private locateSessionDir(id: string): string | null {
    const candidates = new Set([id])
    candidates.add(id.startsWith('session-') ? id.slice('session-'.length) : `session-${id}`)
    for (const projectEntry of this.listDirs(this.sessionsDir)) {
      const projectPath = path.join(this.sessionsDir, projectEntry.name)
      for (const sessionEntry of this.listDirs(projectPath)) {
        if (candidates.has(sessionEntry.name)) {
          return path.join(projectPath, sessionEntry.name)
        }
      }
    }
    return null
  }
}

export const plugin = new DshPlugin()
export default plugin
