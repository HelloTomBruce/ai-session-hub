import { logger } from './logger'
/**
 * 标签服务：标签定义（tag_defs）+ 会话标签（sessions_cache.tags）。
 *
 * 自动打标的历史问题（2026-11 修复）：旧实现把「标题 + 全量消息」拼成一个字符串，
 * 用 `includes()` 做子串匹配，patterns 里又全是 add / fix / update / doc / test 这类泛词，
 * 导致 224 个会话里有 172 个被打了完全相同的 9 个标签 —— 标签失去区分度，还会占满卡片首屏。
 *
 * 现在的判定模型：
 *  - 只看两个高信号位置：标题、本轮会话的「首条真实用户输入」；
 *  - ASCII 词必须词边界命中（避免 prefix → fix、address → add）；
 *  - 强信号（具体词）标题记 3 分；首条用户输入按「命中几个不同强信号词」记 1~2 分；
 *    弱信号（泛词）只认标题且记 2 分；
 *  - 总分 ≥ 2 才算命中，最多取 3 个标签。
 *  校准：首条用户输入的强信号单独即可命中（2 分），因为标题常常是「了解一下 X」这类无信号句式；
 *  泛词（add / fix / update）只在标题里算数，正文里出现再多次也不计入。
 * 存量数据用 `recomputeAllSessionTags()` 重算；重算只覆盖 auto 标签，保留用户手工标签。
 */
import { openHubDb, getHubDb } from './db'
import { firstRealUserMessage } from '../../shared/utils/session-text'
import type Database from 'better-sqlite3'

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
  { name: 'testing', color: '#14b8a6', category: 'auto', created_at: Date.now() }
]

/** 自动标签名集合：重算时先剥离这些旧值，再写入新判定结果 */
const AUTO_TAG_NAMES = new Set(DEFAULT_TAGS.map(t => t.name))

interface TagRule {
  name: string
  /** 强信号：表述具体，标题命中 3 分，首条用户输入命中 1 分 */
  strong: string[]
  /** 弱信号：泛词，只认标题命中（2 分），避免正文里到处都命中 */
  weak: string[]
}

const TAG_RULES: TagRule[] = [
  {
    name: 'bugfix',
    strong: ['报错', '异常排查', '崩溃', '修复', '修正', '缺陷', '错误', '排查', '不生效', 'bug', 'crash', 'debug'],
    weak: ['fix', 'error', 'broken', 'wrong', 'issue']
  },
  {
    name: 'refactor',
    strong: ['重构', 'refactor', '拆分', '抽离', '简化', '整理代码', '代码整洁'],
    weak: ['clean', 'reorganize', 'simplify']
  },
  {
    name: 'feature',
    strong: ['新增', '新功能', '实现', '支持', '改造', '接入', '搭建', '落地', 'feature', 'implement', 'add feature'],
    weak: ['add', 'enable']
  },
  {
    name: 'deploy',
    strong: ['部署', '上线', '发布', '发版', '流水线', 'deploy', 'release', 'rollout'],
    weak: ['publish', 'ci']
  },
  {
    name: 'migration',
    strong: ['迁移', '升级', 'migrate', 'migration', '版本升级', '数据迁移', 'schema 变更'],
    weak: ['upgrade', 'bump', 'version']
  },
  {
    name: 'documentation',
    strong: ['文档', 'readme', '使用说明', '注释', 'guide'],
    weak: ['doc', 'docs', 'comment']
  },
  {
    name: 'performance',
    strong: ['性能', '优化', '提速', '卡顿', '慢', '耗时', '首屏', '响应时间', '渲染优化', 'performance', 'perf'],
    weak: ['slow', 'fast', 'cache', 'lazy']
  },
  {
    name: 'security',
    strong: ['安全', '鉴权', '权限校验', '越权', '密钥', '漏洞', '注入', '认证', 'security'],
    weak: ['auth', 'permission', 'token', 'vuln']
  },
  {
    name: 'testing',
    strong: ['测试', '用例', '回归测试', '覆盖率', '单测', '端到端', 'test', 'spec', 'coverage', 'e2e'],
    weak: ['unit', 'assert']
  }
]

const ASCII_ONLY = /^[\x20-\x7E]+$/

/**
 * 单个 pattern 匹配。
 * - 纯 ASCII：加词边界（前后不能是字母/数字/下划线），杜绝 prefix 命中 fix 这类误判；
 * - 含中文：直接子串匹配（中文没有词边界语义）。
 */
function matchesPattern(haystack: string, pattern: string): boolean {
  const p = pattern.toLowerCase()
  if (!ASCII_ONLY.test(p)) return haystack.includes(p)
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![a-z0-9_-])${escaped}(?![a-z0-9_-])`).test(haystack)
}

function hasAny(text: string, patterns: string[]): boolean {
  return patterns.some(p => matchesPattern(text, p))
}

/** 命中了多少个「不同的」强信号词（用于判断正文里的提到是顺带一提还是真在干这件事） */
function countStrongHits(text: string, patterns: string[]): number {
  let hits = 0
  for (const p of patterns) {
    if (matchesPattern(text, p)) hits++
  }
  return hits
}

/** 首条真实用户输入（跳过注入上下文）：规则收敛在 shared/utils/session-text.ts */
function firstUserMessage(messages: Array<{ role: string, content: string }>): string {
  return firstRealUserMessage(messages, { maxLength: 1500 })
}

const MAX_AUTO_TAGS = 3
const MIN_SCORE = 2

class TagService {
  private db: Database.Database | null = null
  private seeded = false

  private getDb(): Database.Database | null {
    if (this.db) return this.db
    // 主库连接统一由 db.ts 提供（含建表与迁移）
    this.db = getHubDb()
    if (!this.db) return null
    this.seedDefaults(this.db)
    return this.db
  }

  /** 首次拿到连接时补种默认标签定义（表结构由 cache-schema 拥有） */
  private seedDefaults(db: Database.Database): void {
    if (this.seeded) return
    try {
      const count = db.prepare('SELECT COUNT(*) as c FROM tag_defs').get() as { c: number }
      if (count.c === 0) {
        const insert = db.prepare(
          'INSERT OR IGNORE INTO tag_defs (name, color, category, created_at) VALUES (?, ?, ?, ?)'
        )
        for (const tag of DEFAULT_TAGS) {
          insert.run(tag.name, tag.color, tag.category, tag.created_at)
        }
      }
      this.seeded = true
    } catch (err) {
      logger.error('[Tag] Failed to seed default tags:', err)
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
    const tag: TagDef = {
      name,
      color: color || '#6366f1',
      category: (category || 'manual') as TagDef['category'],
      created_at: Date.now()
    }
    if (!db) return tag
    try {
      db.prepare(
        'INSERT OR REPLACE INTO tag_defs (name, color, category, created_at) VALUES (?, ?, ?, ?)'
      ).run(tag.name, tag.color, tag.category, tag.created_at)
    } catch {
      // duplicate or locked db — tag object is still returned
    }
    return tag
  }

  deleteTag(name: string): void {
    const db = this.getDb()
    if (!db) return
    try {
      db.prepare('DELETE FROM tag_defs WHERE name = ?').run(name)
    } catch {
      // ignore delete failures
    }
  }

  /**
   * 获取会话标签 — 从 sessions_cache 中读取
   * 无论会话是否同步缓存，只要 tag 被写入过就能返回
   */
  getSessionTags(sessionId: string, platform: string): string[] {
    const db = this.getDb()
    if (!db) return []
    try {
      const row = db.prepare(
        'SELECT tags FROM sessions_cache WHERE id = ? AND platform = ?'
      ).get(sessionId, platform) as { tags: string } | undefined
      if (row?.tags) {
        try {
          return JSON.parse(row.tags) as string[]
        } catch {
          // corrupted tags json — fall through to empty
        }
      }
    } catch {
      // cache table may not exist yet
    }
    return []
  }

  /**
   * 设置会话标签 — 使用 UPDATE + INSERT 兜底，确保即使会话尚未同步也能写入
   */
  setSessionTags(sessionId: string, platform: string, tags: string[]): boolean {
    const db = this.getDb()
    if (!db) return false
    try {
      const tagsJson = JSON.stringify(tags)
      const now = Date.now()
      const result = db.prepare(
        'UPDATE sessions_cache SET tags = ? WHERE id = ? AND platform = ?'
      ).run(tagsJson, sessionId, platform)
      if (result.changes > 0) return true
      db.prepare(`
        INSERT INTO sessions_cache (id, platform, title, created_at, updated_at, tags)
        VALUES (?, ?, '', ?, ?, ?)
      `).run(sessionId, platform, now, now, tagsJson)
      return true
    } catch (err) {
      logger.error('[Tag] setSessionTags failed:', err)
      return false
    }
  }

  /**
   * 批量合并标签到会话列表（从而在 adapter 数据上也能展示标签）
   */
  mergeTagsToSessions(sessions: Array<{ id: string, cli: string, extra?: Record<string, unknown> }>): void {
    if (sessions.length === 0) return
    const db = this.getDb()
    if (!db) return
    try {
      const allTags = db.prepare(
        'SELECT id, platform, tags FROM sessions_cache WHERE tags IS NOT NULL AND tags != \'[]\''
      ).all() as Array<{ id: string, platform: string, tags: string }>
      const tagMap = new Map<string, string[]>()
      for (const row of allTags) {
        try {
          tagMap.set(`${row.platform}::${row.id}`, JSON.parse(row.tags) as string[])
        } catch {
          // skip corrupted tag rows
        }
      }
      for (const s of sessions) {
        const tags = tagMap.get(`${s.cli}::${s.id}`)
        if (tags?.length) {
          s.extra = { ...(s.extra || {}), tags }
        }
      }
    } catch {
      // sessions_cache may not exist yet
    }
  }

  /**
   * 从标题 + 首条用户输入推断自动标签（最多 3 个，按得分降序）
   */
  autoDetectTags(title: string, messages: Array<{ role: string, content: string }>): string[] {
    const titleText = (title || '').toLowerCase()
    const bodyText = firstUserMessage(messages).toLowerCase()

    const scored: Array<{ name: string, score: number, order: number }> = []

    TAG_RULES.forEach((rule, order) => {
      let score = 0
      if (hasAny(titleText, rule.strong)) score += 3
      // 正文弱化：单次提及只记 1 分，命中 ≥2 个不同强信号词才给满 2 分
      // （避免「顺便 fix 一下」这类顺带提及把标签打满）
      score += Math.min(2, countStrongHits(bodyText, rule.strong))
      if (hasAny(titleText, rule.weak)) score += 2
      if (score >= MIN_SCORE) scored.push({ name: rule.name, score, order })
    })

    return scored
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, MAX_AUTO_TAGS)
      .map(item => item.name)
  }

  /** 自动打标并写入，保留用户手工/AI 标签 */
  autoTagSession(sessionId: string, platform: string, title: string, messages: Array<{ role: string, content: string }>): string[] {
    const detected = this.autoDetectTags(title, messages)
    const manual = this.getSessionTags(sessionId, platform).filter(t => !AUTO_TAG_NAMES.has(t))
    const merged = Array.from(new Set([...detected, ...manual]))
    this.setSessionTags(sessionId, platform, merged)
    return detected
  }

  /**
   * 存量重算：修正历史上被泛词 `includes()` 污染的全量标签。
   * 只覆盖 auto 标签，用户手工建的标签原样保留；分批 + 事务，返回收敛统计。
   */
  recomputeAllSessionTags(limit = 5000): TagRecomputeResult {
    const db = this.getDb()
    if (!db) return { total: 0, updated: 0, changed: 0, errors: 1 }

    const result: TagRecomputeResult = { total: 0, updated: 0, changed: 0, errors: 0 }
    try {
      const rows = db.prepare(
        'SELECT id, platform, title, tags FROM sessions_cache ORDER BY updated_at DESC LIMIT ?'
      ).all(Math.max(1, Math.trunc(limit))) as Array<{ id: string, platform: string, title: string | null, tags: string | null }>
      result.total = rows.length

      // 取前几条用户消息而不是第一条：CLI 常把环境上下文塞成第一条 user 消息
      const firstUserStmt = db.prepare(`
        SELECT content FROM messages_cache
        WHERE session_id = ? AND platform = ? AND role = 'user' AND TRIM(content) != ''
        ORDER BY rowid ASC LIMIT 8
      `)
      const updateStmt = db.prepare('UPDATE sessions_cache SET tags = ? WHERE id = ? AND platform = ?')

      const recompute = db.transaction(() => {
        for (const row of rows) {
          try {
            let existing: string[] = []
            if (row.tags) {
              try {
                existing = JSON.parse(row.tags) as string[]
              } catch {
                existing = []
              }
            }
            const manual = existing.filter(t => !AUTO_TAG_NAMES.has(t))
            const userRows = firstUserStmt.all(row.id, row.platform) as Array<{ content: string }>
            const detected = this.autoDetectTags(row.title || '', userRows.map(r => ({ role: 'user', content: r.content })))
            const next = Array.from(new Set([...detected, ...manual]))
            const nextJson = JSON.stringify(next)

            result.updated++
            if (nextJson !== (row.tags || '[]')) {
              updateStmt.run(nextJson, row.id, row.platform)
              result.changed++
            }
          } catch (err) {
            result.errors++
            logger.error(`[Tag] recompute failed for ${row.platform}/${row.id}:`, err)
          }
        }
      })
      recompute()
    } catch (err) {
      logger.error('[Tag] recomputeAllSessionTags failed:', err)
      result.errors++
    }
    return result
  }
}

export interface TagRecomputeResult {
  total: number
  updated: number
  changed: number
  errors: number
}

export const tagService = new TagService()

// 供测试与工具脚本复用同一套规则，避免测试里重复实现判定逻辑
export const __tagInternals = { TAG_RULES, AUTO_TAG_NAMES, matchesPattern, firstUserMessage, openHubDb }
