import type { EvaluationContext, IEvaluatorStrategy, StrategyScoreResult } from '../types'

/**
 * Evaluates entity impact, project centrality, and multi-tool orchestration complexity
 */
export class TopologyCentralityEvaluator implements IEvaluatorStrategy {
  readonly name = 'topology-centrality'
  readonly defaultWeight = 0.30

  isAvailable(): boolean {
    return true
  }

  async evaluate(ctx: EvaluationContext): Promise<StrategyScoreResult> {
    const signals: string[] = []
    let score = 35 // baseline

    // 1. Tool Call Orchestration Diversity & Friction Analysis
    const toolNames = new Set<string>()
    let totalToolCalls = 0
    let searchReadCount = 0
    let editWriteCount = 0

    for (const msg of ctx.messages) {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        totalToolCalls += msg.toolCalls.length
        for (const tc of msg.toolCalls) {
          const rawName = (tc.name || tc.type || 'unknown').toLowerCase()
          toolNames.add(rawName)
          if (/grep|find|search|glob|list_dir|view_file|read|check/i.test(rawName)) {
            searchReadCount++
          } else if (/edit|write|replace|modify|patch|create/i.test(rawName)) {
            editWriteCount++
          }
        }
      }
    }

    if (totalToolCalls === 0) {
      signals.push('未触发任何外部工具链联动')
      score -= 10
    } else {
      // Check for Tool Search Friction (e.g. 47 tool calls with very few edits)
      const isToolStruggling = totalToolCalls > 20 && (editWriteCount === 0 || (searchReadCount / Math.max(1, editWriteCount) > 8))

      if (isToolStruggling) {
        score -= 25
        signals.push(`⚠️ 检测到严重工具调用摩擦与盲搜死循环 (累计 ${totalToolCalls} 次工具调用，搜索/修改比失衡: ${searchReadCount}:${editWriteCount})`)
      } else if (totalToolCalls >= 3 && totalToolCalls <= 18 && toolNames.size >= 2) {
        score += 20
        signals.push(`调度了 ${toolNames.size} 种工具进行精准协同 (累计调用 ${totalToolCalls} 次)`)
      } else {
        score += 5
        signals.push(`累计触发 ${totalToolCalls} 次工具调用`)
      }
    }

    // 2. Core Entity Detection (Frameworks, Core Utilities, Cross-cutting Concerns)
    const allText = ctx.messages.map(m => m.content + (m.thought || '')).join('\n')

    // Detect critical ecosystem entities
    const criticalEntities: string[] = []
    const entityMatchers: Record<string, RegExp> = {
      '核心数据库/ORM': /(sqlite|better-sqlite3|postgres|mysql|prisma|drizzle|fts5)/i,
      '协议与通信层': /(mcp|sse|websocket|http|rest\s+api|grpc)/i,
      '框架核心生命周期': /(nuxt|vue|nitro|vite|nextjs|react|middleware|pinia)/i,
      '工程与依赖体系': /(package\.json|pnpm|tsconfig|eslint|docker|build|pipeline)/i
    }

    for (const [category, regex] of Object.entries(entityMatchers)) {
      if (regex.test(allText)) {
        criticalEntities.push(category)
      }
    }

    if (criticalEntities.length >= 2) {
      score += 25
      signals.push(`涉及多个跨领域核心拓扑实体: ${criticalEntities.join('、')}`)
    } else if (criticalEntities.length === 1) {
      score += 15
      signals.push(`涉及核心技术实体: ${criticalEntities[0]}`)
    }

    const finalScore = Math.min(100, Math.max(10, score))

    return {
      strategyName: this.name,
      rawScore: finalScore,
      weight: this.defaultWeight,
      confidence: 0.85,
      signals,
      details: {
        totalToolCalls,
        uniqueTools: Array.from(toolNames),
        criticalEntities
      }
    }
  }
}
