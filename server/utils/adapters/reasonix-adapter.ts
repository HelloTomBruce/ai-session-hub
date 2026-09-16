import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'
import { BaseSqliteAdapter } from '../base-sqlite-adapter'
import type { CreateSessionPayload, SessionMessage, SessionToolCall, UnifiedSession, UpdateSessionPayload } from '../types'

const homeDir = os.homedir()
const reasonixDir = path.join(homeDir, '.reasonix')

/** Row shape of the `topics` table in topic-state-v1.sqlite. */
interface ReasonixTopicRow {
  topic_id: string
  title?: string
  created_at_ms?: number
  updated_at_ms?: number
  auto_meta_json?: string
}

/** Shape of a `.jsonl.meta` sidecar file. */
interface ReasonixMetaFile {
  id?: string
  topic_id?: string
  topic_title?: string
  preview?: string
  created_at?: string
  updated_at?: string
  workspace_root?: string
  model?: string
  turns?: number
}

/** Parsed `auto_meta_json` payload stored on topic rows. */
interface ReasonixAutoMeta {
  cwd?: string
  workspace?: string
  model?: string
}

/** A single line in a Reasonix conversation JSONL file. */
interface ReasonixMessageLine {
  role?: string
  name?: string
  tool_name?: string
  local_only?: boolean
  content?: unknown
  raw_content?: unknown
  reasoning_content?: unknown
  thought?: unknown
  tool_calls?: ReasonixToolCallEntry[]
  createdAt?: number
  timestamp?: number
}

interface ReasonixToolCallEntry {
  id?: string
  name?: string
  arguments?: unknown
  function?: {
    name?: string
    arguments?: unknown
  }
}

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
    const extraJsonlPath = session?.extra?.jsonlPath
    if (typeof extraJsonlPath === 'string' && extraJsonlPath && fs.existsSync(extraJsonlPath)) {
      return extraJsonlPath
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
        } catch {
          // unreadable directory; skip it and keep searching
        }
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
      const jsonlPath = sess.extra?.jsonlPath
      if (typeof jsonlPath === 'string' && seenJsonlPaths.has(jsonlPath)) return
      const topicId = sess.extra?.topic_id
      if (typeof topicId === 'string' && seenIds.has(topicId)) return

      seenIds.add(sess.id)
      if (typeof topicId === 'string') seenIds.add(topicId)
      if (typeof jsonlPath === 'string') seenJsonlPaths.add(jsonlPath)
      sessions.push(sess)
    }

    const scanSessionDir = (dir: string, isTrash: boolean, projName: string, topicsMap: Map<string, ReasonixTopicRow>) => {
      try {
        const files = fs.readdirSync(dir)
        for (const f of files) {
          if (f.endsWith('.jsonl.meta')) {
            const metaPath = path.join(dir, f)
            const jsonlPath = path.join(dir, f.replace(/\.meta$/, ''))
            try {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as ReasonixMetaFile
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
                id: meta.id || topicId || '',
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
            } catch {
              // unreadable or malformed meta file; skip it
            }
          }
        }
      } catch {
        // unreadable session directory; skip it
      }
    }

    const scanTrashDir = (trashDir: string, projName: string, topicsMap: Map<string, ReasonixTopicRow>) => {
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
          } catch {
            // unreadable trash entry; skip it
          }
        }
      } catch {
        // unreadable trash directory; skip it
      }
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
          const topicsMap = new Map<string, ReasonixTopicRow>()
          if (fs.existsSync(projDbPath)) {
            let db!: Database.Database
            try {
              db = new Database(projDbPath, { readonly: true })
              const rows = db.prepare('SELECT topic_id, title, created_at_ms, updated_at_ms, auto_meta_json FROM topics').all() as ReasonixTopicRow[]
              for (const row of rows) {
                topicsMap.set(row.topic_id, row)
              }
            } catch {
              // project database unavailable; fall back to meta file timestamps
            } finally {
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
                const meta = JSON.parse(row.auto_meta_json) as ReasonixAutoMeta
                cwd = meta.cwd || meta.workspace || ''
                model = meta.model || ''
              }
            } catch {
              // malformed auto_meta_json; keep empty cwd/model
            }

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
      } catch {
        // projects directory unreadable; rely on the global database only
      }
    }

    // 2. Scan Global Database
    const globalDbPath = path.join(reasonixDir, 'desktop', 'topic-state-v1.sqlite')
    if (fs.existsSync(globalDbPath)) {
      let db!: Database.Database
      try {
        db = new Database(globalDbPath, { readonly: true })
        const rows = db.prepare('SELECT topic_id, title, created_at_ms, updated_at_ms, auto_meta_json FROM topics').all() as ReasonixTopicRow[]
        for (const row of rows) {
          let cwd = ''
          let model = ''
          try {
            if (row.auto_meta_json) {
              const meta = JSON.parse(row.auto_meta_json) as ReasonixAutoMeta
              cwd = meta.cwd || meta.workspace || ''
              model = meta.model || ''
            }
          } catch {
            // malformed auto_meta_json; keep empty cwd/model
          }

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
      } catch {
        // global database unavailable; nothing to add
      } finally {
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
            const parsed = JSON.parse(line) as ReasonixMessageLine
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
              let formattedTools: SessionToolCall[] | undefined
              if (toolCalls && toolCalls.length) {
                formattedTools = toolCalls.map((tc) => {
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
              if (!cleanContent && parsed.raw_content) {
                cleanContent = typeof parsed.raw_content === 'string' ? parsed.raw_content : JSON.stringify(parsed.raw_content)
              }

              messages.push({
                id: `msg_${i}`,
                role: 'user',
                content: cleanContent || (typeof content === 'string' ? content : JSON.stringify(content)),
                timestamp
              })
            }
          } catch {
            // malformed jsonl line; skip it
          }
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
      let db!: Database.Database
      try {
        db = new Database(globalDbPath)
        if (payload.title) {
          const res = db.prepare('UPDATE topics SET title = ?, updated_at_ms = ? WHERE topic_id = ?').run(payload.title, Date.now(), id)
          if (res.changes > 0) updated = true
        }
      } catch {
        // global database update failed; try the next location
      } finally {
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
            let db!: Database.Database
            try {
              db = new Database(projDbPath)
              if (payload.title) {
                const res = db.prepare('UPDATE topics SET title = ?, updated_at_ms = ? WHERE topic_id = ?').run(payload.title, Date.now(), id)
                if (res.changes > 0) updated = true
              }
            } catch {
              // project database update failed; continue with the next project
            } finally {
              if (db) db.close()
            }
          }
        }
      } catch {
        // projects directory unreadable; continue
      }
    }

    // Update in meta files
    const session = this.getSessions().find(s => s.id === id || s.extra?.topic_id === id)
    const metaPath = session?.extra?.metaPath
    if (typeof metaPath === 'string' && metaPath && fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<string, unknown>
        meta.topic_title = payload.title
        meta.title = payload.title
        meta.updated_at = new Date().toISOString()
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
        updated = true
      } catch {
        // meta file update failed; other updates may still have succeeded
      }
    }

    return updated
  }

  deleteSession(id: string): boolean {
    let deleted = false
    const session = this.getSessions().find(s => s.id === id || s.extra?.topic_id === id || s.extra?.sessionId === id)
    const extraTopicId = session?.extra?.topic_id
    const topicId = (typeof extraTopicId === 'string' && extraTopicId) ? extraTopicId : id
    const extraSessionId = session?.extra?.sessionId
    const sessionId = (typeof extraSessionId === 'string' && extraSessionId) ? extraSessionId : session?.id || id

    // 1. Delete specific file paths from session metadata
    const metaPath = session?.extra?.metaPath
    if (typeof metaPath === 'string' && metaPath && fs.existsSync(metaPath)) {
      try {
        fs.unlinkSync(metaPath)
        deleted = true
      } catch (e) {
        console.error('[ReasonixAdapter] Error deleting metaPath:', e)
      }
    }
    const jsonlPath = session?.extra?.jsonlPath
    if (typeof jsonlPath === 'string' && jsonlPath && fs.existsSync(jsonlPath)) {
      try {
        fs.unlinkSync(jsonlPath)
        deleted = true
      } catch (e) {
        console.error('[ReasonixAdapter] Error deleting jsonlPath:', e)
      }
    }
    if (session?.rawLocation && fs.existsSync(session.rawLocation)) {
      try {
        fs.unlinkSync(session.rawLocation)
        deleted = true
      } catch (e) {
        console.error('[ReasonixAdapter] Error deleting rawLocation:', e)
      }
    }

    // 2. Scan and delete matching files across ~/.reasonix/projects and ~/.reasonix/sessions
    const scanAndRemoveFiles = (dir: string) => {
      if (!fs.existsSync(dir)) return
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            scanAndRemoveFiles(full)
          } else if (entry.isFile()) {
            if (
              entry.name.includes(sessionId)
              || entry.name.includes(topicId)
              || entry.name === `${sessionId}.jsonl`
              || entry.name === `${sessionId}.jsonl.meta`
              || entry.name === `${topicId}.jsonl`
              || entry.name === `${topicId}.jsonl.meta`
            ) {
              try {
                fs.unlinkSync(full)
                deleted = true
              } catch {
                // file removal failed; continue with remaining matches
              }
            }
          }
        }
      } catch {
        // directory unreadable; continue
      }
    }

    const projectsDir = path.join(reasonixDir, 'projects')
    scanAndRemoveFiles(projectsDir)

    const globalSessionsDir = path.join(reasonixDir, 'sessions')
    scanAndRemoveFiles(globalSessionsDir)

    // 3. Delete in global db
    const globalDbPath = path.join(reasonixDir, 'desktop', 'topic-state-v1.sqlite')
    if (fs.existsSync(globalDbPath)) {
      let db!: Database.Database
      try {
        db = new Database(globalDbPath)
        const res = db.prepare('DELETE FROM topics WHERE topic_id = ? OR topic_id = ?').run(topicId, sessionId)
        if (res.changes > 0) deleted = true
      } catch (e) {
        console.error('[ReasonixAdapter] Error deleting from global db:', e)
      } finally {
        if (db) db.close()
      }
    }

    // 4. Delete in project dbs
    if (fs.existsSync(projectsDir)) {
      try {
        const entries = fs.readdirSync(projectsDir)
        for (const entry of entries) {
          const projDbPath = path.join(projectsDir, entry, 'desktop', 'topic-state-v1.sqlite')
          if (fs.existsSync(projDbPath)) {
            let db!: Database.Database
            try {
              db = new Database(projDbPath)
              const res = db.prepare('DELETE FROM topics WHERE topic_id = ? OR topic_id = ?').run(topicId, sessionId)
              if (res.changes > 0) deleted = true
            } catch (e) {
              console.error(`[ReasonixAdapter] Error deleting from project db ${entry}:`, e)
            } finally {
              if (db) db.close()
            }
          }
        }
      } catch {
        // projects directory unreadable; continue
      }
    }

    // If session was originally found in registry, treat as deleted
    if (session) {
      deleted = true
    }

    return deleted
  }

  createSession(payload: CreateSessionPayload): UnifiedSession {
    const targetCwd = payload.cwd || homeDir
    const now = Date.now()
    const id = `session_${Math.random().toString(36).substring(2, 10)}_${Date.now()}`

    const globalDbPath = path.join(reasonixDir, 'desktop', 'topic-state-v1.sqlite')
    if (fs.existsSync(globalDbPath)) {
      let db!: Database.Database
      try {
        db = new Database(globalDbPath)
        db.prepare(`
          INSERT INTO topics (topic_id, title, created_at_ms, updated_at_ms, auto_meta_json)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, payload.title || 'New Reasonix Topic', now, now, JSON.stringify({ cwd: targetCwd }))
      } catch {
        // topic insert failed; session is still returned from the registry scan
      } finally {
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
