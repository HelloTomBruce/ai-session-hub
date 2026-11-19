import '../../utils/session-service'
import { adapterRegistry } from '../../utils/adapter-registry'
import { knowledgeService, type KnowledgeItem } from '../../utils/knowledge-service'
import { cacheService } from '../../utils/cache-service'
import { recallStats } from '../../utils/recall-stats'

export interface ToolCategoryStats {
  category: 'edit' | 'search_read' | 'command' | 'subagent' | 'mcp' | 'other'
  label: string
  icon: string
  color: string
  count: number
  percentage: number
}

export interface PlatformStatItem {
  platform: string
  name: string
  count: number
  percentage: number
  messageCount: number
}

export interface HotspotTagItem {
  tag: string
  count: number
  typeBreakdown: {
    adr: number
    gotcha: number
    pattern: number
    milestone: number
  }
}

export interface HighValueSessionItem {
  id: string
  platform: string
  title: string
  cwd: string
  updatedAt: number
  score: number
  grade: 'S' | 'A' | 'B' | 'C'
  signals: string[]
  isVaultWorthy: boolean
}

/** Shape of a row in the `session_evaluations` cache table (schema v4, Rubric v2 column names). */
interface CachedEvaluationRow {
  session_id: string
  platform: string
  overall_score: number
  grade: 'S' | 'A' | 'B' | 'C'
  signals_json: string
  is_worth_saving: number
  evaluated_at: number
}

/**
 * 度量样本充分性：本页的召回效果结论建立在「诊断索引 + 召回曝光」之上，
 * 样本过薄时前端必须显式标注结论不可信，而不是用空图表冒充分析。
 */
export interface MeasurementStats {
  /** session_diagnoses 行数（已索引诊断的会话数） */
  diagnosedSessions: number
  /** recall_events 行数（召回曝光次数） */
  recallEvents: number
  /** session_evaluations 行数（已量化评估的会话数） */
  evaluatedSessions: number
  /** 会话总数 */
  totalSessions: number
  /** 诊断覆盖率 = diagnosedSessions / totalSessions，0-1，保留两位 */
  coverage: number
  /** coverage ≥ 30% 且 recallEvents ≥ 50 才认为样本充分 */
  sampleSufficient: boolean
}

/** 样本充分性阈值：覆盖率下限（30%） */
export const SAMPLE_COVERAGE_THRESHOLD = 0.3
/** 样本充分性阈值：召回曝光次数下限（50 次） */
export const SAMPLE_RECALL_EVENTS_THRESHOLD = 50

type CacheDb = ReturnType<typeof cacheService.getDb>

/**
 * 单表计数：表缺失 / 连接不可用 / SQL 失败一律降级为 0，
 * 保证度量字段永不把接口拖成 500。
 */
function safeCountSessions(db: CacheDb): number {
  if (!db) return 0
  try {
    const row = db.prepare('SELECT COUNT(*) AS c FROM sessions_cache').get() as { c?: number } | undefined
    return typeof row?.c === 'number' ? row.c : 0
  } catch {
    return 0
  }
}

function safeCountRows(db: CacheDb, table: 'session_diagnoses' | 'session_evaluations'): number {
  if (!db) return 0
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c?: number } | undefined
    return typeof row?.c === 'number' ? row.c : 0
  } catch {
    return 0
  }
}

/** 逐项兜底统计度量样本，任一项失败只影响该项计数（降级为 0），不向上抛错。 */
function buildMeasurement(adapterTotalSessions: number): MeasurementStats {
  let diagnosedSessions: number
  let evaluatedSessions: number
  let cachedSessions: number
  let recallEvents: number

  try {
    const db = cacheService.getDb()
    diagnosedSessions = safeCountRows(db, 'session_diagnoses')
    evaluatedSessions = safeCountRows(db, 'session_evaluations')
    cachedSessions = safeCountSessions(db)
  } catch {
    diagnosedSessions = 0
    evaluatedSessions = 0
    cachedSessions = 0
  }

  try {
    recallEvents = recallStats.countEvents()
  } catch {
    recallEvents = 0
  }

  // 分母取「缓存会话总数」与 adapter 口径的较大者：诊断索引按 sessions_cache 回填，
  // 只用 adapter 口径会出现「已索引 223 / 总数 221」这种刺眼数字。
  const adapterTotal = Number.isFinite(adapterTotalSessions) ? Math.max(0, adapterTotalSessions) : 0
  const safeTotal = Math.max(adapterTotal, cachedSessions)
  const coverage = safeTotal > 0
    ? Math.min(1, Math.round((diagnosedSessions / safeTotal) * 100) / 100)
    : 0

  return {
    diagnosedSessions,
    evaluatedSessions,
    recallEvents,
    totalSessions: safeTotal,
    coverage,
    sampleSufficient: coverage >= SAMPLE_COVERAGE_THRESHOLD && recallEvents >= SAMPLE_RECALL_EVENTS_THRESHOLD
  }
}

export default defineEventHandler(async (_event) => {
  try {
    const allSessions = cacheService.isAvailable()
      ? cacheService.getCachedSessions()
      : adapterRegistry.getAllSessions()
    const { items: vaultItems } = knowledgeService.listItems({ limit: 1000 })

    // 1. Basic Stats
    const totalSessions = allSessions.length
    const totalMessages = allSessions.reduce((acc, s) => acc + (s.messageCount || 0), 0)

    // 2. Vault Breakdown
    const vaultBreakdown = {
      total: vaultItems.length,
      adr: vaultItems.filter((i: KnowledgeItem) => i.type?.toLowerCase() === 'adr').length,
      gotcha: vaultItems.filter((i: KnowledgeItem) => i.type?.toLowerCase() === 'gotcha').length,
      pattern: vaultItems.filter((i: KnowledgeItem) => i.type?.toLowerCase() === 'pattern').length,
      milestone: vaultItems.filter((i: KnowledgeItem) => i.type?.toLowerCase() === 'milestone').length
    }

    // 3. Platform Distribution
    const platformCounts: Record<string, { count: number, messages: number }> = {}
    for (const s of allSessions) {
      if (!platformCounts[s.cli]) {
        platformCounts[s.cli] = { count: 0, messages: 0 }
      }
      const p = platformCounts[s.cli]
      if (p) {
        p.count++
        p.messages += (s.messageCount || 0)
      }
    }

    const platformMeta: Record<string, string> = {
      pi: 'Pi CLI',
      opencode: 'OpenCode',
      agy: 'AGY CLI',
      claude: 'Claude Code',
      codex: 'Codex App',
      workbuddy: 'WorkBuddy',
      reasonix: 'Reasonix',
      kimi: 'Kimi CLI',
      trae: 'Trae',
      cursor: 'Cursor',
      mimo: 'Mimo CLI',
      zcode: 'ZCode',
      dsh: 'DeepSeek Harness'
    }

    const platforms: PlatformStatItem[] = Object.entries(platformCounts)
      .map(([platform, data]) => ({
        platform,
        name: platformMeta[platform] || platform.toUpperCase(),
        count: data.count,
        percentage: totalSessions > 0 ? Math.round((data.count / totalSessions) * 100) : 0,
        messageCount: data.messages
      }))
      .sort((a, b) => b.count - a.count)

    // 4. Sample sessions to aggregate Tool Calls and Thoughts
    let totalThoughtCount = 0
    let totalThoughtChars = 0
    const toolRawCounts: Record<string, number> = {}

    // Sample top 40 most active/recent sessions for tool aggregation to ensure high performance
    const sampleSessions = allSessions.slice(0, 40)
    for (const s of sampleSessions) {
      try {
        const { messages } = cacheService.isAvailable()
          ? cacheService.getCachedSessionDetail(s.cli, s.id)
          : adapterRegistry.getMessages(s.cli, s.id)
        for (const msg of messages) {
          if (msg.thought) {
            totalThoughtCount++
            totalThoughtChars += msg.thought.length
          }
          if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
            for (const tool of msg.toolCalls) {
              let name = tool.name || tool.type || 'unknown'
              name = name.replace(/^default_api:/, '').replace(/^mcp__.*?__/, '')
              toolRawCounts[name] = (toolRawCounts[name] || 0) + 1
            }
          }
        }
      } catch {
        // ignore single parse fail
      }
    }

    // Categorize Tools
    let editCount = 0
    let searchReadCount = 0
    let commandCount = 0
    let subagentCount = 0
    let mcpCount = 0
    let otherCount = 0

    for (const [toolName, count] of Object.entries(toolRawCounts)) {
      const lower = toolName.toLowerCase()
      if (lower.includes('replace') || lower.includes('write') || lower.includes('edit') || lower.includes('patch') || lower.includes('create_file')) {
        editCount += count
      } else if (lower.includes('read') || lower.includes('view') || lower.includes('search') || lower.includes('grep') || lower.includes('find') || lower.includes('list_dir') || lower.includes('glob')) {
        searchReadCount += count
      } else if (lower.includes('command') || lower.includes('bash') || lower.includes('exec') || lower.includes('terminal') || lower.includes('task')) {
        commandCount += count
      } else if (lower.includes('agent') || lower.includes('message') || lower.includes('subagent')) {
        subagentCount += count
      } else if (lower.includes('mcp') || lower.includes('call_mcp')) {
        mcpCount += count
      } else {
        otherCount += count
      }
    }

    const totalToolCalls = editCount + searchReadCount + commandCount + subagentCount + mcpCount + otherCount
    const allCategories: ToolCategoryStats[] = [
      {
        category: 'search_read',
        label: '探索检索与阅读 (Search & Read)',
        icon: 'i-lucide-search',
        color: 'blue',
        count: searchReadCount,
        percentage: totalToolCalls > 0 ? Math.round((searchReadCount / totalToolCalls) * 100) : 0
      },
      {
        category: 'edit',
        label: '代码修改与写入 (Code Edit)',
        icon: 'i-lucide-file-code',
        color: 'emerald',
        count: editCount,
        percentage: totalToolCalls > 0 ? Math.round((editCount / totalToolCalls) * 100) : 0
      },
      {
        category: 'command',
        label: '指令与终端运行 (Command Execution)',
        icon: 'i-lucide-terminal',
        color: 'purple',
        count: commandCount,
        percentage: totalToolCalls > 0 ? Math.round((commandCount / totalToolCalls) * 100) : 0
      },
      {
        category: 'subagent',
        label: '子智能体协同 (Subagent Orchestration)',
        icon: 'i-lucide-users',
        color: 'amber',
        count: subagentCount,
        percentage: totalToolCalls > 0 ? Math.round((subagentCount / totalToolCalls) * 100) : 0
      },
      {
        category: 'mcp',
        label: 'MCP 协议扩展 (MCP Tools)',
        icon: 'i-lucide-plug',
        color: 'cyan',
        count: mcpCount,
        percentage: totalToolCalls > 0 ? Math.round((mcpCount / totalToolCalls) * 100) : 0
      },
      {
        category: 'other',
        label: '其他辅助工具',
        icon: 'i-lucide-box',
        color: 'zinc',
        count: otherCount,
        percentage: totalToolCalls > 0 ? Math.round((otherCount / totalToolCalls) * 100) : 0
      }
    ]

    const toolCategories = allCategories.filter(c => c.count > 0).sort((a, b) => b.count - a.count)

    // 5. Hotspot Tags from Knowledge Vault
    const tagMap: Record<string, { count: number, adr: number, gotcha: number, pattern: number, milestone: number }> = {}
    for (const item of vaultItems) {
      if (item.tags && Array.isArray(item.tags)) {
        for (const t of item.tags) {
          const norm = t.trim().toLowerCase()
          if (!norm) continue
          if (!tagMap[norm]) {
            tagMap[norm] = { count: 0, adr: 0, gotcha: 0, pattern: 0, milestone: 0 }
          }
          const cur = tagMap[norm]
          if (cur) {
            cur.count++
            const typeKey = (item.type || '').toLowerCase()
            if (typeKey === 'adr') cur.adr++
            else if (typeKey === 'gotcha') cur.gotcha++
            else if (typeKey === 'pattern') cur.pattern++
            else if (typeKey === 'milestone') cur.milestone++
          }
        }
      }
    }

    const hotspotTags: HotspotTagItem[] = Object.entries(tagMap)
      .map(([tag, data]) => ({
        tag,
        count: data.count,
        typeBreakdown: {
          adr: data.adr,
          gotcha: data.gotcha,
          pattern: data.pattern,
          milestone: data.milestone
        }
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)

    // 6. High Value Sessions from database cache
    const db = cacheService.getDb()
    let cachedEvaluations: CachedEvaluationRow[] = []
    if (db) {
      try {
        cachedEvaluations = db.prepare(`
          SELECT session_id, platform, overall_score, grade, signals_json, is_worth_saving, evaluated_at
          FROM session_evaluations
          ORDER BY overall_score DESC
          LIMIT 10
        `).all() as CachedEvaluationRow[]
      } catch {
        cachedEvaluations = []
      }
    }

    const highValueSessions: HighValueSessionItem[] = cachedEvaluations.map((row: CachedEvaluationRow) => {
      const session = adapterRegistry.getSession(row.platform, row.session_id)
      let parsedSignals: string[]
      try {
        parsedSignals = JSON.parse(row.signals_json || '[]')
      } catch {
        parsedSignals = []
      }

      return {
        id: row.session_id,
        platform: row.platform,
        title: session?.title || row.session_id,
        cwd: session?.cwd || '',
        updatedAt: row.evaluated_at || session?.updatedAt || Date.now(),
        score: row.overall_score,
        grade: row.grade,
        signals: parsedSignals,
        isVaultWorthy: Boolean(row.is_worth_saving)
      }
    })

    // 7. Measurement Coverage：让样本不足显式可见（前端据此标注「结论暂不可信」）
    const measurement = buildMeasurement(totalSessions)

    return {
      success: true,
      measurement,
      data: {
        summary: {
          totalSessions,
          totalMessages,
          totalThoughtCount,
          totalThoughtChars,
          avgThoughtsPerSession: totalSessions > 0 ? (totalThoughtCount / Math.min(totalSessions, 40)).toFixed(1) : '0',
          totalVaultItems: vaultBreakdown.total,
          vaultBreakdown
        },
        platforms,
        toolCategories,
        totalToolCalls,
        hotspotTags,
        highValueSessions
      }
    }
  } catch (error) {
    return {
      success: false,
      error: (error as { message?: string })?.message || String(error)
    }
  }
})
