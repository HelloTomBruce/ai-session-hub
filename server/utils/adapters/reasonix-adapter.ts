import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'
import { BaseSqliteAdapter } from '../base-sqlite-adapter'
import type { CreateSessionPayload, SessionMessage, UnifiedSession, UpdateSessionPayload } from '../types'

const homeDir = os.homedir()
const reasonixDir = path.join(homeDir, '.reasonix')

export class ReasonixSessionAdapter extends BaseSqliteAdapter {
  constructor() {
    super({
      id: 'reasonix',
      name: 'Reasonix',
      category: 'app',
      dbPath: path.join(reasonixDir, 'desktop', 'topic-state-v1.sqlite')
    })
  }

  private decodeProjectDir(name: string): string {
    if (!name || !name.startsWith('-')) return ''
    const parts = name.slice(1).split('-')
    let curr = '/' + parts[0]
    let i = 1
    while (i < parts.length) {
      let found = false
      for (let j = parts.length; j > i; j--) {
        const sub = parts.slice(i, j).join('-')
        const candidate = path.join(curr, sub)
        if (fs.existsSync(candidate)) {
          curr = candidate
          i = j
          found = true
          break
        }
      }
      if (!found) {
        curr = path.join(curr, parts[i] || '')
        i++
      }
    }
    return curr
  }

  private findJsonlPath(id: string, session?: UnifiedSession): string {
    if (session?.extra?.jsonlPath && fs.existsSync(session.extra.jsonlPath)) {
      return session.extra.jsonlPath
    }
    if (session?.rawLocation && session.rawLocation.endsWith('.jsonl') && fs.existsSync(session.rawLocation)) {
      return session.rawLocation
    }

    // Search in ~/.reasonix/projects/
    const projectsDir = path.join(reasonixDir, 'projects')
    if (fs.existsSync(projectsDir)) {
      const queue = [projectsDir]
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
        } catch {}
      }
    }

    return ''
  }

  getSessions(): UnifiedSession[] {
    const sessions: UnifiedSession[] = []
    const seenIds = new Set<string>()
    const seenJsonlPaths = new Set<string>()

    const addSession = (sess: UnifiedSession) => {
      if (!sess.id) return
      if (seenIds.has(sess.id)) return
      if (sess.extra?.jsonlPath && seenJsonlPaths.has(sess.extra.jsonlPath)) return
      if (sess.extra?.topic_id && seenIds.has(sess.extra.topic_id)) return

      seenIds.add(sess.id)
      if (sess.extra?.topic_id) seenIds.add(sess.extra.topic_id)
      if (sess.extra?.jsonlPath) seenJsonlPaths.add(sess.extra.jsonlPath)
      sessions.push(sess)
    }

    const scanSessionDir = (dir: string, isTrash: boolean, projName: string, topicsMap: Map<string, any>) => {
      try {
        const files = fs.readdirSync(dir)
        for (const f of files) {
          if (f.endsWith('.jsonl.meta')) {
            const metaPath = path.join(dir, f)
            const jsonlPath = path.join(dir, f.replace(/\.meta$/, ''))
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
              const topicId = meta.topic_id
              const topicRow = topicId ? topicsMap.get(topicId) : null
              if (topicId) topicsMap.delete(topicId)

              let createdAt = Date.now()
              let updatedAt = Date.now()
              if (meta.created_at) createdAt = new Date(meta.created_at).getTime()
              else if (topicRow?.created_at_ms) createdAt = topicRow.created_at_ms

              if (meta.updated_at) updatedAt = new Date(meta.updated_at).getTime()
              else if (topicRow?.updated_at_ms) updatedAt = topicRow.updated_at_ms
              else updatedAt = createdAt

              const title = meta.topic_title || topicRow?.title || meta.preview || `Reasonix Session ${meta.id?.slice(0, 8)}`
              const cwd = meta.workspace_root || this.decodeProjectDir(projName) || path.join(homeDir, '.reasonix', 'global-workspace')

              addSession({
                id: meta.id || topicId,
                cli: 'reasonix',
                category: 'app',
                title,
                cwd,
                createdAt,
                updatedAt,
                model: meta.model || '',
                messageCount: meta.turns,
                status: isTrash ? 'Archived' : 'Active',
                rawLocation: fs.existsSync(jsonlPath) ? jsonlPath : metaPath,
                extra: {
                  topic_id: topicId,
                  sessionId: meta.id,
                  jsonlPath: fs.existsSync(jsonlPath) ? jsonlPath : undefined,
                  metaPath,
                  isTrash
                }
              })
            } catch {}
          }
        }
      } catch {}
    }

    const scanTrashDir = (trashDir: string, projName: string, topicsMap: Map<string, any>) => {
      try {
        const entries = fs.readdirSync(trashDir)
        for (const entry of entries) {
          const full = path.join(trashDir, entry)
          try {
            const stat = fs.statSync(full)
            if (stat.isDirectory()) {
              scanSessionDir(full, true, projName, topicsMap)
            } else if (entry.endsWith('.jsonl.meta')) {
              scanSessionDir(trashDir, true, projName, topicsMap)
            }
          } catch {}
        }
      } catch {}
    }

    // 1. Scan projects directory
    const projectsDir = path.join(reasonixDir, 'projects')
    if (fs.existsSync(projectsDir)) {
      try {
        const entries = fs.readdirSync(projectsDir)
        for (const entry of entries) {
          const projDir = path.join(projectsDir, entry)
          try {
            if (!fs.statSync(projDir).isDirectory()) continue
          } catch {
            continue
          }

          const projDbPath = path.join(projDir, 'desktop', 'topic-state-v1.sqlite')
          const topicsMap = new Map<string, any>()
          if (fs.existsSync(projDbPath)) {
            let db: any
            try {
              db = new Database(projDbPath, { readonly: true })
              const rows = db.prepare('SELECT topic_id, title, created_at_ms, updated_at_ms, auto_meta_json FROM topics').all()
              for (const row of rows) {
                topicsMap.set(row.topic_id, row)
              }
            } catch {}
            finally {
              if (db) db.close()
            }
          }

          const sessionsDir = path.join(projDir, 'sessions')
          if (fs.existsSync(sessionsDir)) {
            scanSessionDir(sessionsDir, false, entry, topicsMap)
            const trashDir = path.join(sessionsDir, '.trash')
            if (fs.existsSync(trashDir)) {
              scanTrashDir(trashDir, entry, topicsMap)
            }
          }

          // Any remaining topics in project SQLite
          for (const [, row] of topicsMap.entries()) {
            let cwd = ''
            let model = ''
            try {
              if (row.auto_meta_json) {
                const meta = JSON.parse(row.auto_meta_json)
                cwd = meta.cwd || meta.workspace || ''
                model = meta.model || ''
              }
            } catch {}

            addSession({
              id: row.topic_id,
              cli: 'reasonix',
              category: 'app',
              title: row.title || `Reasonix Topic ${row.topic_id.slice(0, 8)}`,
              cwd: cwd || this.decodeProjectDir(entry) || path.join(homeDir, '.reasonix', 'global-workspace'),
              createdAt: row.created_at_ms || Date.now(),
              updatedAt: row.updated_at_ms || row.created_at_ms || Date.now(),
              model,
              status: 'Active',
              rawLocation: projDbPath,
              extra: {
                topic_id: row.topic_id,
                dbPath: projDbPath
              }
            })
          }
        }
      } catch {}
    }

    // 2. Scan Global Database
    const globalDbPath = path.join(reasonixDir, 'desktop', 'topic-state-v1.sqlite')
    if (fs.existsSync(globalDbPath)) {
      let db: any
      try {
        db = new Database(globalDbPath, { readonly: true })
        const rows = db.prepare('SELECT topic_id, title, created_at_ms, updated_at_ms, auto_meta_json FROM topics').all()
        for (const row of rows) {
          let cwd = ''
          let model = ''
          try {
            if (row.auto_meta_json) {
              const meta = JSON.parse(row.auto_meta_json)
              cwd = meta.cwd || meta.workspace || ''
              model = meta.model || ''
            }
          } catch {}

          addSession({
            id: row.topic_id,
            cli: 'reasonix',
            category: 'app',
            title: row.title || `Reasonix Topic ${row.topic_id.slice(0, 8)}`,
            cwd: cwd || path.join(homeDir, '.reasonix', 'global-workspace'),
            createdAt: row.created_at_ms || Date.now(),
            updatedAt: row.updated_at_ms || row.created_at_ms || Date.now(),
            model,
            status: 'Active',
            rawLocation: globalDbPath,
            extra: {
              topic_id: row.topic_id,
              dbPath: globalDbPath
            }
          })
        }
      } catch {}
      finally {
        if (db) db.close()
      }
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getMessages(id: string, session?: UnifiedSession): SessionMessage[] {
    const jsonlPath = this.findJsonlPath(id, session)
    const messages: SessionMessage[] = []

    if (jsonlPath && fs.existsSync(jsonlPath)) {
      try {
        const lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean)
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (!line) continue
          try {
            const parsed = JSON.parse(line)
            const role = parsed.role
            if (role === 'system') continue
            if (role === 'tool' && parsed.local_only) continue

            const content = parsed.content || parsed.raw_content || ''
            const thought = parsed.reasoning_content || parsed.thought || ''
            const toolCalls = parsed.tool_calls || []
            const timestamp = parsed.createdAt || parsed.timestamp || undefined

            if (role === 'tool') {
              messages.push({
                id: `msg_${i}`,
                role: 'tool',
                name: parsed.name || parsed.tool_name || 'tool',
                content: typeof content === 'string' ? content : JSON.stringify(content),
                timestamp
              })
            } else if (role === 'assistant') {
              let parsedThought: string | undefined
              if (thought) {
                parsedThought = typeof thought === 'string' ? thought.trim() : JSON.stringify(thought)
              }
              let formattedTools: any[] | undefined
              if (toolCalls && toolCalls.length) {
                formattedTools = toolCalls.map((tc: any) => {
                  let args = tc.arguments || tc.function?.arguments || {}
                  if (typeof args === 'string') {
                    try {
                      args = JSON.parse(args)
                    } catch {
                      args = {}
                    }
                  }
                  return {
                    id: tc.id,
                    name: tc.name || tc.function?.name || 'tool',
                    arguments: args
                  }
                })
              }

              messages.push({
                id: `msg_${i}`,
                role: 'assistant',
                content: typeof content === 'string' ? content.trim() : JSON.stringify(content),
                thought: parsedThought,
                toolCalls: formattedTools,
                timestamp
              })
            } else if (role === 'user') {
              let cleanContent = typeof content === 'string' ? content : JSON.stringify(content)
              if (cleanContent.includes('<interrupted-turn-recovery>')) {
                cleanContent = cleanContent.replace(/<interrupted-turn-recovery>[\s\S]*?<\/interrupted-turn-recovery>/g, '').trim()
              }
              if (cleanContent.includes('<reasoning-language>')) {
                cleanContent = cleanContent.replace(/<reasoning-language>[\s\S]*?<\/reasoning-language>/g, '').trim()
              }
              if (cleanContent.includes('<response-language>')) {
                cleanContent = cleanContent.replace(/<response-language>[\s\S]*?<\/response-language>/g, '').trim()
              }
              if (!cleanContent && parsed.raw_content) cleanContent = parsed.raw_content

              messages.push({
                id: `msg_${i}`,
                role: 'user',
                content: cleanContent || content,
                timestamp
              })
            }
          } catch {}
        }
      } catch (e) {
        console.error('Error reading reasonix jsonl:', e)
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
    let updated = false

    // Update in global db
    const globalDbPath = path.join(reasonixDir, 'desktop', 'topic-state-v1.sqlite')
    if (fs.existsSync(globalDbPath)) {
      let db: any
      try {
        db = new Database(globalDbPath)
        if (payload.title) {
          const res = db.prepare('UPDATE topics SET title = ?, updated_at_ms = ? WHERE topic_id = ?').run(payload.title, Date.now(), id)
          if (res.changes > 0) updated = true
        }
      } catch {}
      finally {
        if (db) db.close()
      }
    }

    // Update in project dbs and meta files
    const projectsDir = path.join(reasonixDir, 'projects')
    if (fs.existsSync(projectsDir)) {
      try {
        const entries = fs.readdirSync(projectsDir)
        for (const entry of entries) {
          const projDbPath = path.join(projectsDir, entry, 'desktop', 'topic-state-v1.sqlite')
          if (fs.existsSync(projDbPath)) {
            let db: any
            try {
              db = new Database(projDbPath)
              if (payload.title) {
                const res = db.prepare('UPDATE topics SET title = ?, updated_at_ms = ? WHERE topic_id = ?').run(payload.title, Date.now(), id)
                if (res.changes > 0) updated = true
              }
            } catch {}
            finally {
              if (db) db.close()
            }
          }
        }
      } catch {}
    }

    // Update in meta files
    const session = this.getSessions().find(s => s.id === id || s.extra?.topic_id === id)
    if (session?.extra?.metaPath && fs.existsSync(session.extra.metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(session.extra.metaPath, 'utf-8'))
        meta.topic_title = payload.title
        meta.title = payload.title
        meta.updated_at = new Date().toISOString()
        fs.writeFileSync(session.extra.metaPath, JSON.stringify(meta, null, 2), 'utf-8')
        updated = true
      } catch {}
    }

    return updated
  }

  deleteSession(id: string): boolean {
    let deleted = false

    // Delete in global db
    const globalDbPath = path.join(reasonixDir, 'desktop', 'topic-state-v1.sqlite')
    if (fs.existsSync(globalDbPath)) {
      let db: any
      try {
        db = new Database(globalDbPath)
        const res = db.prepare('DELETE FROM topics WHERE topic_id = ?').run(id)
        if (res.changes > 0) deleted = true
      } catch {}
      finally {
        if (db) db.close()
      }
    }

    // Delete in project dbs
    const projectsDir = path.join(reasonixDir, 'projects')
    if (fs.existsSync(projectsDir)) {
      try {
        const entries = fs.readdirSync(projectsDir)
        for (const entry of entries) {
          const projDbPath = path.join(projectsDir, entry, 'desktop', 'topic-state-v1.sqlite')
          if (fs.existsSync(projDbPath)) {
            let db: any
            try {
              db = new Database(projDbPath)
              const res = db.prepare('DELETE FROM topics WHERE topic_id = ?').run(id)
              if (res.changes > 0) deleted = true
            } catch {}
            finally {
              if (db) db.close()
            }
          }
        }
      } catch {}
    }

    return deleted
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const targetCwd = payload.cwd || homeDir
    const now = Date.now()
    const id = `session_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`

    const globalDbPath = path.join(reasonixDir, 'desktop', 'topic-state-v1.sqlite')
    if (fs.existsSync(globalDbPath)) {
      let db: any
      try {
        db = new Database(globalDbPath)
        db.prepare(`
          INSERT INTO topics (topic_id, title, created_at_ms, updated_at_ms, auto_meta_json)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, payload.title || 'New Reasonix Topic', now, now, JSON.stringify({ cwd: targetCwd }))
      } catch {}
      finally {
        if (db) db.close()
      }
    }

    return {
      id,
      cli: 'reasonix',
      category: 'app',
      title: payload.title || `Reasonix ${id.slice(0, 8)}`,
      cwd: targetCwd,
      createdAt: now,
      updatedAt: now,
      rawLocation: globalDbPath
    }
  }
}

