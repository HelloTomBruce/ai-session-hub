import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { BaseJsonlAdapter } from '../base-jsonl-adapter'
import type { CreateSessionPayload, SessionMessage, UnifiedSession } from '../types'

const homeDir = os.homedir()

export class ClaudeSessionAdapter extends BaseJsonlAdapter {
  constructor() {
    super({
      id: 'claude',
      name: 'Claude Code',
      category: 'cli',
      baseDir: path.join(homeDir, '.claude', 'projects')
    })
  }

  getSessions(): UnifiedSession[] {
    const sessions: UnifiedSession[] = []
    if (!this.isAvailable()) return sessions

    try {
      const projectDirs = fs.readdirSync(this.baseDir)
      for (const pDir of projectDirs) {
        const fullPDir = path.join(this.baseDir, pDir)
        if (!fs.statSync(fullPDir).isDirectory()) continue

        const files = fs.readdirSync(fullPDir)
        for (const file of files) {
          if (file.endsWith('.jsonl')) {
            const filePath = path.join(fullPDir, file)
            try {
              const stat = fs.statSync(filePath)
              const id = file.replace('.jsonl', '')
              let title = ''
              let messageCount = 0
              let cwd = ''

              const lines = this.readJsonl(filePath)
              for (const parsed of lines) {
                if (parsed.cwd && !cwd) cwd = parsed.cwd
                if (parsed.type === 'user' || parsed.role === 'user' || parsed.type === 'human') {
                  messageCount++
                  if (!title) {
                    const text = typeof parsed.message === 'string' 
                      ? parsed.message 
                      : parsed.message?.content || parsed.text || ''
                    if (text) title = text.slice(0, 100).replace(/\n/g, ' ')
                  }
                } else if (parsed.type === 'assistant' || parsed.role === 'assistant') {
                  messageCount++
                }
              }

              sessions.push({
                id,
                cli: 'claude',
                category: 'cli',
                title: title || `Claude Session ${id.slice(0, 8)}`,
                cwd: cwd || pDir.replace(/^-/, '/').replace(/-/g, '/'),
                createdAt: stat.birthtimeMs || stat.ctimeMs,
                updatedAt: stat.mtimeMs,
                messageCount,
                rawLocation: filePath
              })
            } catch {}
          }
        }
      }
    } catch {}

    return sessions
  }

  getMessages(_id: string, session?: UnifiedSession): SessionMessage[] {
    if (!session || !fs.existsSync(session.rawLocation)) return []
    const lines = this.readJsonl(session.rawLocation)
    const messages: SessionMessage[] = []

    for (const parsed of lines) {
      const role = parsed.role || parsed.type === 'human' ? 'user' : 'assistant'
      let content = ''
      if (typeof parsed.message === 'string') content = parsed.message
      else if (parsed.message?.content) {
        if (typeof parsed.message.content === 'string') content = parsed.message.content
        else if (Array.isArray(parsed.message.content)) {
          content = parsed.message.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
        }
      } else if (parsed.text) {
        content = parsed.text
      }

      if (content || parsed.tool_use) {
        messages.push({
          id: parsed.id || parsed.messageId,
          role: role as any,
          content: content || '',
          timestamp: parsed.timestamp ? new Date(parsed.timestamp).getTime() : undefined,
          toolCalls: parsed.tool_use ? [parsed.tool_use] : undefined
        })
      }
    }

    return messages
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const targetCwd = payload.cwd || homeDir
    const now = Date.now()
    const id = `session_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`
    const folderName = `-${targetCwd.replace(/^\//, '').replace(/\//g, '-')}`
    const pDir = path.join(this.baseDir, folderName)
    if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true })

    const filePath = path.join(pDir, `${id}.jsonl`)
    let content = ''
    if (payload.initialPrompt) {
      content += JSON.stringify({
        type: 'user',
        id: `msg_${Date.now()}`,
        cwd: targetCwd,
        message: payload.initialPrompt,
        timestamp: Date.now()
      }) + '\n'
    } else {
      content += JSON.stringify({
        type: 'session_init',
        cwd: targetCwd,
        timestamp: Date.now()
      }) + '\n'
    }

    fs.writeFileSync(filePath, content, 'utf-8')

    return {
      id,
      cli: 'claude',
      category: 'cli',
      title: payload.title || payload.initialPrompt || `Claude Session ${id.slice(0, 8)}`,
      cwd: targetCwd,
      createdAt: now,
      updatedAt: now,
      messageCount: payload.initialPrompt ? 1 : 0,
      rawLocation: filePath
    }
  }
}
