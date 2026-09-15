import '../../utils/session-service'
import { adapterRegistry } from '../../utils/adapter-registry'
import { knowledgeService, type KnowledgeItem } from '../../utils/knowledge-service'
import { cacheService } from '../../utils/cache-service'

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

export default defineEventHandler(async (event) => {
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
    const platformCounts: Record<string, { count: number; messages: number }> = {}
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
      mimo: 'Mimo CLI'
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
    const tagMap: Record<string, { count: number; adr: number; gotcha: number; pattern: number; milestone: number }> = {}
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
    let cachedEvaluations: any[] = []
    if (db) {
      try {
        cachedEvaluations = db.prepare(`
          SELECT session_id, platform, score, grade, signals, is_vault_worthy, updated_at
          FROM session_evaluations
          ORDER BY score DESC
          LIMIT 10
        `).all()
      } catch {
        cachedEvaluations = []
      }
    }

    const highValueSessions: HighValueSessionItem[] = cachedEvaluations.map((row: any) => {
      const session = adapterRegistry.getSession(row.platform, row.session_id)
      let parsedSignals: string[] = []
      try {
        parsedSignals = JSON.parse(row.signals || '[]')
      } catch {
        parsedSignals = []
      }

      return {
        id: row.session_id,
        platform: row.platform,
        title: session?.title || row.session_id,
        cwd: session?.cwd || '',
        updatedAt: row.updated_at || session?.updatedAt || Date.now(),
        score: row.score,
        grade: row.grade,
        signals: parsedSignals,
        isVaultWorthy: Boolean(row.is_vault_worthy)
      }
    })

    return {
      success: true,
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
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || String(error)
    }
  }
})
