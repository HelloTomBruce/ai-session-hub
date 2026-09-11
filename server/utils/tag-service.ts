import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'

const DB_DIR = path.join(os.homedir(), '.session-hub')
const DB_PATH = path.join(DB_DIR, 'session-hub.db')

export interface TagDef {
  name: string
  color: string
  category: 'auto' | 'manual' | 'ai'
  created_at: number
}

const DEFAULT_TAGS: TagDef[] = [
  { name: 'bugfix', color: '#ef4444', category: 'auto', created_at: Date.now() },
  { name: 'refactor', color: '#f59e0b', category: 'auto', created_at: Date.now() },
  { name: 'feature', color: '#22c55e', category: 'auto', created_at: Date.now() },
  { name: 'deploy', color: '#3b82f6', category: 'auto', created_at: Date.now() },
  { name: 'migration', color: '#8b5cf6', category: 'auto', created_at: Date.now() },
  { name: 'documentation', color: '#06b6d4', category: 'auto', created_at: Date.now() },
  { name: 'performance', color: '#ec4899', category: 'auto', created_at: Date.now() },
  { name: 'security', color: '#dc2626', category: 'auto', created_at: Date.now() },
  { name: 'testing', color: '#14b8a6', category: 'auto', created_at: Date.now() },
  { name: 'ai:诊断', color: '#a855f7', category: 'ai', created_at: Date.now() }
]

// 自动标签规则
interface TagRule {
  name: string
  patterns: string[]       // 匹配关键词（大小写不敏感）
  category: 'auto'
}

const TAG_RULES: TagRule[] = [
  { name: 'bugfix', patterns: ['fix', 'bug', 'error', '报错', '异常', 'crash', 'broken', 'wrong', 'issue'], category: 'auto' },
  { name: 'refactor', patterns: ['refactor', '重构', 'clean', '简化', '整理', 'reorganize'], category: 'auto' },
  { name: 'feature', patterns: ['feat', 'feature', 'add', '新增', '新功能', 'implement'], category: 'auto' },
  { name: 'deploy', patterns: ['deploy', 'release', '发布', '上线', 'rollout', 'ci', 'cd'], category: 'auto' },
  { name: 'migration', patterns: ['migrate', 'upgrade', '升级', '迁移', 'version', 'bump', 'update'], category: 'auto' },
  { name: 'documentation', patterns: ['doc', 'docs', '文档', 'readme', 'comment', '说明', 'guide'], category: 'auto' },
  { name: 'performance', patterns: ['perf', 'performance', '优化', '速度', 'slow', 'fast', 'cache', 'lazy', '性能'], category: 'auto' },
  { name: 'security', patterns: ['security', '安全', 'auth', 'token', 'permission', '危险', 'vuln'], category: 'auto' },
  { name: 'testing', patterns: ['test', 'spec', '测试', 'unit', 'e2e', 'coverage', 'assert'], category: 'auto' }
]

class TagService {
  private db: Database.Database | null = null

  private getDb(): Database.Database | null {
    if (this.db) return this.db
    try {
      if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })
      this.db = new Database(DB_PATH)
      this.db.pragma('journal_mode = WAL')

      // 确保 tag_defs 表存在
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tag_defs (
          name TEXT PRIMARY KEY,
          color TEXT NOT NULL DEFAULT '#6366f1',
          category TEXT NOT NULL DEFAULT 'manual',
          created_at INTEGER NOT NULL
        )
      `)

      // 初始默认标签
      const count = this.db.prepare('SELECT COUNT(*) as c FROM tag_defs').get() as { c: number }
      if (count.c === 0) {
        const insert = this.db.prepare(
          'INSERT OR IGNORE INTO tag_defs (name, color, category, created_at) VALUES (?, ?, ?, ?)'
        )
        for (const tag of DEFAULT_TAGS) {
          insert.run(tag.name, tag.color, tag.category, tag.created_at)
        }
      }

      return this.db
    } catch {
      return null
    }
  }

  getAllTags(): TagDef[] {
    const db = this.getDb()
    if (!db) return []
    try {
      return db.prepare(
        'SELECT name, color, category, created_at FROM tag_defs ORDER BY name ASC'
      ).all() as TagDef[]
    } catch {
      return []
    }
  }

  createTag(name: string, color?: string, category?: string): TagDef {
    const db = this.getDb()
    const tag = {
      name,
      color: color || '#6366f1',
      category: (category || 'manual') as 'auto' | 'manual' | 'ai',
      created_at: Date.now()
    }
    try {
      db!.prepare(
        'INSERT OR REPLACE INTO tag_defs (name, color, category, created_at) VALUES (?, ?, ?, ?)'
      ).run(tag.name, tag.color, tag.category, tag.created_at)
    } catch {}
    return tag
  }

  deleteTag(name: string): void {
    const db = this.getDb()
    if (!db) return
    try {
      db.prepare('DELETE FROM tag_defs WHERE name = ?').run(name)
    } catch {}
  }

  /**
   * 根据会话内容自动推断标签
   */
  autoDetectTags(title: string, messages: Array<{ role: string; content: string }>): string[] {
    const matched = new Set<string>()
    const allText = [
      title,
      ...messages.map(m => m.content)
    ].join(' ').toLowerCase()

    for (const rule of TAG_RULES) {
      for (const pattern of rule.patterns) {
        if (allText.includes(pattern.toLowerCase())) {
          matched.add(rule.name)
          break
        }
      }
    }

    return Array.from(matched)
  }

  /**
   * 获取会话当前标签
   */
  getSessionTags(sessionId: string, platform: string): string[] {
    const db = this.getDb()
    if (!db) return []
    try {
      const row = db.prepare(
        'SELECT tags FROM sessions_cache WHERE id = ? AND platform = ?'
      ).get(sessionId, platform) as { tags: string } | undefined
      if (row?.tags) {
        try { return JSON.parse(row.tags) } catch {}
      }
    } catch {}
    return []
  }

  /**
   * 设置会话标签
   */
  setSessionTags(sessionId: string, platform: string, tags: string[]): boolean {
    const db = this.getDb()
    if (!db) return false
    try {
      db.prepare(
        "UPDATE sessions_cache SET tags = ? WHERE id = ? AND platform = ?"
      ).run(JSON.stringify(tags), sessionId, platform)
      return true
    } catch {
      return false
    }
  }

  /**
   * 在缓存同步时自动对所有新会话打标签
   */
  autoTagSession(sessionId: string, platform: string, title: string, messages: Array<{ role: string; content: string }>): string[] {
    const tags = this.autoDetectTags(title, messages)
    if (tags.length > 0) {
      this.setSessionTags(sessionId, platform, tags)
    }
    return tags
  }
}

export const tagService = new TagService()
