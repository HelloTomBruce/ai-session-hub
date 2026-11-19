import { logger } from './logger'
/**
 * 全文检索实现（从 cache-service 拆出，避免单文件承担 5 类职责）。
 *
 * 只依赖一个已就绪的 SQLite 连接和分词器，不含生命周期与连接管理；
 * 调用方负责建连与错误降级。
 */
import type Database from 'better-sqlite3'
import { escapeFtsQuery } from './fts-query'

export interface SearchResultItem {
  rowid: number
  message_id: string
  session_id: string
  platform: string
  role: string
  title: string
  cwd: string
  tags: string[]
  updated_at: number
  snippet: string
  tool_summary?: string
  rank: number
}

export interface SessionGroupedSearchResult {
  session_id: string
  platform: string
  title: string
  cwd: string
  tags: string[]
  updated_at: number
  matchedCount: number
  bestRank: number
  snippets: Array<{
    message_id: string
    role: string
    snippet: string
  }>
}

export interface SearchOptions {
  platform?: string
  role?: string
  cwd?: string
  tag?: string
  limit?: number
  offset?: number
  groupBy?: 'session' | 'message'
}

export interface SearchResponse {
  results: SearchResultItem[]
  total: number
  query: string
  page: number
  pageSize: number
  platforms?: Record<string, number>
  groupedSessions?: SessionGroupedSearchResult[]
}

export function searchMessages(db: Database.Database, segmenter: Intl.Segmenter, query: string, options: SearchOptions = {}): SearchResponse {
  const limit = Math.min(100, Math.max(1, options.limit ?? 20))
  const offset = Math.max(0, options.offset ?? 0)
  const groupBy = options.groupBy || 'session'
  const page = Math.floor(offset / limit) + 1

  if (!db || !query.trim()) {
    return { results: [], total: 0, query, page, pageSize: limit }
  }

  const empty: SearchResponse = { results: [], total: 0, query, page, pageSize: limit }

  try {
    const ftsQuery = escapeFtsQuery(query, segmenter)
    if (!ftsQuery) return empty

    // 动态拼接过滤条件
    const conditions: string[] = ['fts_messages MATCH ?']
    const params: unknown[] = [ftsQuery]

    if (options.platform && options.platform !== 'all') {
      conditions.push('f.platform = ?')
      params.push(options.platform)
    }

    if (options.role && options.role !== 'all') {
      conditions.push('f.role = ?')
      params.push(options.role)
    }

    if (options.cwd) {
      conditions.push('s.cwd LIKE ?')
      params.push(`%${options.cwd}%`)
    }

    if (options.tag) {
      conditions.push('s.tags LIKE ?')
      params.push(`%${options.tag}%`)
    }

    // 已知限制：cwd/tag 过滤均为前导通配 %LIKE%，无法利用索引，
    // 只能作为 FTS 命中结果的后置过滤，代价随命中消息数线性增长。

    const whereClause = conditions.join(' AND ')

    // 1. 统计总匹配消息数及各平台分布。
    // 已知限制：COUNT + GROUP BY 需扫描全部命中行（FTS5 无近似计数），
    // 命中集合极大时本查询随匹配消息总量线性变慢。
    const countSql = `
      SELECT f.platform, COUNT(*) as c
      FROM fts_messages f
      LEFT JOIN sessions_cache s ON s.id = f.session_id AND s.platform = f.platform
      WHERE ${whereClause}
      GROUP BY f.platform
    `
    const platformCounts = db.prepare(countSql).all(...params) as { platform: string, c: number }[]
    const platformMap: Record<string, number> = {}
    let total = 0
    for (const p of platformCounts) {
      platformMap[p.platform] = p.c
      total += p.c
    }

    if (total === 0) return empty

    // 2. 查询明细
    const searchSql = `
      SELECT
        f.rowid,
        f.message_id,
        f.session_id,
        f.platform,
        f.role,
        s.title,
        s.cwd,
        s.tags,
        s.updated_at,
        f.tool_summary,
        snippet(fts_messages, 0, '<mark>', '</mark>', '...', 40) AS snippet,
        f.rank
      FROM fts_messages f
      LEFT JOIN sessions_cache s ON s.id = f.session_id AND s.platform = f.platform
      WHERE ${whereClause}
      ORDER BY f.rank
      LIMIT ? OFFSET ?
    `

    // 如果是按会话聚合，多拉取一些记录以供会话级聚合展示
    const fetchLimit = groupBy === 'session' ? Math.max(100, limit * 5) : limit
    const rows = db.prepare(searchSql).all(...params, fetchLimit, offset) as Array<{
      rowid: number
      message_id: string
      session_id: string
      platform: string
      role: string
      title: string
      cwd: string
      tags: string
      updated_at: number
      tool_summary?: string
      snippet: string
      rank: number
    }>

    const results: SearchResultItem[] = rows.map((r) => {
      let tags: string[] = []
      try {
        if (r.tags) tags = JSON.parse(r.tags) as string[]
      } catch {
        tags = []
      }

      return {
        rowid: r.rowid,
        message_id: r.message_id || `msg_${r.rowid}`,
        session_id: r.session_id,
        platform: r.platform,
        role: r.role,
        title: r.title || '无标题会话',
        cwd: r.cwd || '',
        tags,
        updated_at: r.updated_at || Date.now(),
        snippet: cleanSnippetSpaces(r.snippet),
        tool_summary: r.tool_summary || undefined,
        rank: r.rank
      }
    })

    if (groupBy === 'session') {
      const sessionMap = new Map<string, SessionGroupedSearchResult>()
      for (const item of results) {
        const key = `${item.platform}::${item.session_id}`
        if (!sessionMap.has(key)) {
          sessionMap.set(key, {
            session_id: item.session_id,
            platform: item.platform,
            title: item.title,
            cwd: item.cwd,
            tags: item.tags,
            updated_at: item.updated_at,
            matchedCount: 0,
            bestRank: item.rank,
            snippets: []
          })
        }
        const group = sessionMap.get(key)!
        group.matchedCount++
        if (item.rank < group.bestRank) {
          group.bestRank = item.rank
        }
        if (group.snippets.length < 5) {
          group.snippets.push({
            message_id: item.message_id,
            role: item.role,
            snippet: item.snippet
          })
        }
      }

      const groupedSessions = Array.from(sessionMap.values())
        .sort((a, b) => a.bestRank - b.bestRank)
        .slice(0, limit)

      return {
        results,
        groupedSessions,
        total,
        query,
        page,
        pageSize: limit,
        platforms: platformMap
      }
    }

    return {
      results,
      total,
      query,
      page,
      pageSize: limit,
      platforms: platformMap
    }
  } catch (err) {
    logger.error('[Cache] FTS5 search error:', err)
    return empty
  }
}

function cleanSnippetSpaces(snippet: string): string {
  if (!snippet) return ''
  return snippet
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2')
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2')
}
