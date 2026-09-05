import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { BaseJsonlAdapter } from '../base-jsonl-adapter'
import type { CreateSessionPayload, SessionMessage, UnifiedSession } from '../types'

const homeDir = os.homedir()

export class PiSessionAdapter extends BaseJsonlAdapter {
  constructor() {
    super({
      id: 'pi',
      name: 'Pi CLI',
      category: 'cli',
      baseDir: path.join(homeDir, '.pi', 'agent', 'sessions')
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
              const lines = this.readJsonl(filePath)
              
              let id = file.replace('.jsonl', '')
              let cwd = ''
              let title = ''
              let model = ''
              let messageCount = 0

              for (const parsed of lines) {
                if (parsed.type === 'session') {
                  id = parsed.id || id
                  cwd = parsed.cwd || cwd
                } else if (parsed.type === 'model_change') {
                  model = parsed.modelId || model
                } else if (parsed.type === 'message') {
                  messageCount++
                  if (!title && parsed.message?.role === 'user') {
                    const text = typeof parsed.message.content === 'string'
                      ? parsed.message.content
                      : Array.isArray(parsed.message.content)
                        ? parsed.message.content.find((c: any) => c.type === 'text')?.text || ''
                        : ''
                    if (text) title = text.slice(0, 100).replace(/\n/g, ' ')
                  }
                }
              }

              sessions.push({
                id,
                cli: 'pi',
                category: 'cli',
                title: title || `Pi Session ${id.slice(0, 8)}`,
                cwd: cwd || pDir.replace(/^--/, '/').replace(/--$/, '').replace(/-/g, '/'),
                createdAt: stat.birthtimeMs || stat.ctimeMs,
                updatedAt: stat.mtimeMs,
                messageCount,
                model,
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
      if (parsed.type === 'message') {
        const role = parsed.message?.role || 'assistant'
        let content = ''
        let thought = ''
        const toolCalls: any[] = []

        if (typeof parsed.message?.content === 'string') {
          content = parsed.message.content
        } else if (Array.isArray(parsed.message?.content)) {
          for (const part of parsed.message.content) {
            if (part.type === 'text') content += (content ? '\n' : '') + part.text
            if (part.type === 'thinking') thought += (thought ? '\n' : '') + part.thinking
            if (part.type === 'toolCall' || part.type === 'toolUse') toolCalls.push(part)
          }
        }

        messages.push({
          id: parsed.id,
          role,
          content: content || (thought ? `*(Thinking)*\n${thought}` : ''),
          timestamp: parsed.timestamp ? new Date(parsed.timestamp).getTime() : undefined,
          model: parsed.model || parsed.message?.model,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          thought: thought || undefined
        })
      }
    }

    return messages
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const targetCwd = payload.cwd || homeDir
    const now = Date.now()
    const id = `session_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`
    const folderName = `--${targetCwd.replace(/^\//, '').replace(/\//g, '-')}--`
    const piDir = path.join(this.baseDir, folderName)
    if (!fs.existsSync(piDir)) fs.mkdirSync(piDir, { recursive: true })

    const filePath = path.join(piDir, `${id}.jsonl`)
    const sessionHeader = JSON.stringify({
      type: 'session',
      version: 3,
      id,
      timestamp: new Date().toISOString(),
      cwd: targetCwd
    })
    
    let content = sessionHeader + '\n'
    if (payload.initialPrompt) {
      content += JSON.stringify({
        type: 'message',
        id: `msg_${Math.random().toString(36).substring(2, 8)}`,
        timestamp: new Date().toISOString(),
        message: {
          role: 'user',
          content: payload.initialPrompt,
          timestamp: Date.now()
        }
      }) + '\n'
    }

    fs.writeFileSync(filePath, content, 'utf-8')

    return {
      id,
      cli: 'pi',
      category: 'cli',
      title: payload.title || payload.initialPrompt || `Pi Session ${id.slice(0, 8)}`,
      cwd: targetCwd,
      createdAt: now,
      updatedAt: now,
      messageCount: payload.initialPrompt ? 1 : 0,
      rawLocation: filePath
    }
  }
}
