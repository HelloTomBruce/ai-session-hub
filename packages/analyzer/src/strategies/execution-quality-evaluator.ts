/**
 * execution-quality（原 topology-centrality 重写）：
 * 不做全文技术词命中。评估执行轨迹质量（工具编排、读写比、闭环）
 * 与改动位置关键性（按文件路径表）。
 */
import type { EvaluationContext, IEvaluatorStrategy, Signal, StrategyFlags, StrategyScoreResult } from '../types.js'
import type { EvaluationEvidence } from '../evidence/normalize.js'

// 核心路径：契约/服务/核心包
const CORE_PATH_RE = /(^|\/)(server\/utils|server\/api|packages\/[^/]+\/src|lib\/core|src\/core)\//
// 根配置/构建
const CONFIG_PATH_RE = /(^|\/)(nuxt\.config|package\.json|tsconfig|pnpm-workspace|eslint\.config|vite\.config|Dockerfile)/
// 低结构权重：文档/样式/静态页
const DOC_STYLE_PATH_RE = /\.(md|css|scss)$|(^|\/)(docs?|public\/assets)\//

export class ExecutionQualityEvaluator implements IEvaluatorStrategy {
  readonly name = 'execution-quality'

  isAvailable(): boolean {
    return true
  }

  async evaluate(_ctx: EvaluationContext, ev: EvaluationEvidence): Promise<StrategyScoreResult> {
    const signals: Signal[] = []
    const flags: StrategyFlags = {}
    let score = 25

    const totalCalls = ev.metrics.toolCallCount
    const kinds = ev.metrics.uniqueToolKinds
    const reads = ev.metrics.searchReadCount
    const edits = ev.metrics.editWriteCount

    // 1. 工具编排
    if (totalCalls === 0) {
      score -= 5
      signals.push({ code: 'NO_TOOL_USE', polarity: 'neutral', message: '未触发工具链联动' })
    } else {
      const ratio = reads / Math.max(1, edits)
      const searchLoop = totalCalls > 25 && (edits === 0 || ratio > 10)
      if (searchLoop) {
        flags.searchLoop = true
        score -= 20
        signals.push({
          code: 'SEARCH_LOOP',
          polarity: 'negative',
          message: `盲搜死循环：${totalCalls} 次调用、读写比 ${reads}:${edits} 且无有效修改闭环`,
          evidence: `${totalCalls} calls, read/edit=${reads}/${edits}`
        })
      } else if (totalCalls >= 3 && totalCalls <= 18 && kinds >= 2) {
        score += 15
        signals.push({ code: 'DIVERSE_ORCHESTRATION', polarity: 'positive', message: `${kinds} 类工具协同，调用 ${totalCalls} 次，节奏精准` })
      } else {
        score += 5
        signals.push({ code: 'TOOL_USE_PLAIN', polarity: 'neutral', message: `工具调用 ${totalCalls} 次` })
      }

      // 健康读写比加分
      if (!searchLoop && edits > 0 && ratio >= 1 / 3 && ratio <= 6) {
        score += 8
        signals.push({ code: 'HEALTHY_READ_EDIT_RATIO', polarity: 'positive', message: `搜索/修改比健康（约 ${ratio.toFixed(1)}:1）` })
      }
    }

    // 2. 闭环证据
    if (ev.endsWithError) {
      flags.unresolved = true
      score -= 15
      signals.push({
        code: 'UNRESOLVED_ENDING',
        polarity: 'negative',
        message: '末轮停在报错/未解决表述上，缺少交付结论',
        evidence: String(ev.endsWithError).slice(0, 80)
      })
    } else if (ev.closedLoop) {
      score += 12
      signals.push({ code: 'CLOSED_LOOP', polarity: 'positive', message: '会话以交付总结或编辑后验证闭环收尾' })
    }

    // 3. 改动位置关键性（按路径，而非聊天关键词）
    const paths = ev.changedFiles.map(f => f.path)
    if (paths.length > 0) {
      const core = paths.some(p => CORE_PATH_RE.test(p) || CONFIG_PATH_RE.test(p))
      const docsOnly = paths.every(p => DOC_STYLE_PATH_RE.test(p))
      if (core) {
        score += 12
        signals.push({ code: 'CORE_LOCATION', polarity: 'positive', message: '改动落在核心模块/根配置路径' })
      } else if (docsOnly) {
        score += 5
        signals.push({ code: 'DOC_STYLE_LOCATION', polarity: 'neutral', message: '改动集中在文档/样式层' })
      } else {
        score += 10
      }
    }

    return {
      strategyName: this.name,
      rawScore: Math.min(100, Math.max(10, score)),
      confidence: 0.85,
      signals,
      flags,
      details: { totalCalls, reads, edits, uniqueKinds: kinds, closedLoop: ev.closedLoop }
    }
  }
}
