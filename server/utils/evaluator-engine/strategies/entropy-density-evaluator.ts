import type { EvaluationContext, IEvaluatorStrategy, StrategyScoreResult } from '../types'

/**
 * Evaluates semantic information density, rationale depth, and troubleshooting signal ratio
 */
export class EntropyDensityEvaluator implements IEvaluatorStrategy {
  readonly name = 'entropy-density'
  readonly defaultWeight = 0.35

  isAvailable(): boolean {
    return true
  }

  async evaluate(ctx: EvaluationContext): Promise<StrategyScoreResult> {
    const signals: string[] = []
    let score = 30 // baseline

    const userMessages = ctx.messages.filter(m => m.role === 'user')
    const assistantMessages = ctx.messages.filter(m => m.role === 'assistant')

    // 1. Check conversation turn count & interactivity
    const turnCount = userMessages.length
    if (turnCount === 0) {
      return {
        strategyName: this.name,
        rawScore: 10,
        weight: this.defaultWeight,
        confidence: 0.95,
        signals: ['空会话或无效交互'],
        details: { turnCount: 0 }
      }
    }

    if (turnCount >= 1 && turnCount <= 8) {
      score += 15
      signals.push(`具有明确的交互闭环与迭代深度 (${turnCount} 轮)`)
    } else if (turnCount > 12) {
      score -= 10
      signals.push('会话轮次过多，可能存在较多拉扯或无效尝试')
    }

    // 2. Analyze Thinking Process / Reasoning Density
    const thoughtBlocks = assistantMessages.map(m => m.thought || '').filter(t => t.length > 10)
    const totalThoughtLen = thoughtBlocks.reduce((acc, t) => acc + t.length, 0)
    const fullThoughtText = thoughtBlocks.join('\n')

    // Detect Thrashing (Thinking Bloat / Loop)
    const isThrashing = totalThoughtLen > 15000 || (thoughtBlocks.length >= 10 && totalThoughtLen > 10000)

    if (isThrashing) {
      score -= 30
      signals.push(`⚠️ 思维链严重膨胀 (共 ${thoughtBlocks.length} 处思考，约 ${Math.round(totalThoughtLen / 1000)}k 字)，存在明显的思绪空转/反复重试 (Thrashing)`)
    } else if (thoughtBlocks.length > 0 && totalThoughtLen >= 50 && totalThoughtLen <= 6000) {
      score += 25
      signals.push(`包含高密度思维链推导 (共 ${thoughtBlocks.length} 处深度思考，约 ${totalThoughtLen} 字)`)
    } else if (totalThoughtLen > 6000 && totalThoughtLen <= 15000) {
      score += 10
      signals.push(`思考链篇幅较长 (${Math.round(totalThoughtLen / 1000)}k 字)，有效信息密度呈边际递减`)
    } else {
      score -= 10
      signals.push('缺少结构化思考链或推导过程较为浅层')
    }

    if (!isThrashing && thoughtBlocks.length > 0) {
      // Check for reasoning indicators: trade-offs, root cause analysis, gotcha discoveries
      const hasTradeoff = /(tradeoff|权衡|方案对比|之所以|选型|代替|优缺点|相比于)/i.test(fullThoughtText)
      const hasRootCause = /(根因|root cause|根本原因|导致|之所以报错|超时原因|分析发现)/i.test(fullThoughtText)
      const hasGotchaWarning = /(注意点|陷阱|避坑|坑点|限制|缺陷|特异性)/i.test(fullThoughtText)

      if (hasTradeoff) {
        score += 15
        signals.push('思维链中识别到技术方案选型与权衡分析')
      }
      if (hasRootCause) {
        score += 15
        signals.push('思维链中包含深入的 Bug 根因剖析与诊断')
      }
      if (hasGotchaWarning) {
        score += 10
        signals.push('沉淀了具体的避坑点与限制边界')
      }
    }

    // 3. Information Compression / Redundancy Check
    const allContents = ctx.messages.map(m => m.content).join('\n')
    const uniqueLines = new Set(allContents.split('\n').map(l => l.trim()).filter(l => l.length > 5))
    const totalLines = allContents.split('\n').filter(l => l.trim().length > 5).length

    const duplicationRatio = totalLines > 0 ? (totalLines - uniqueLines.size) / totalLines : 0
    if (duplicationRatio > 0.6) {
      score -= 20
      signals.push('存在大量重复日志或高同质化文本输出，有效信息熵偏低')
    }

    const finalScore = Math.min(100, Math.max(10, score))

    return {
      strategyName: this.name,
      rawScore: finalScore,
      weight: this.defaultWeight,
      confidence: 0.88,
      signals,
      details: {
        turnCount,
        thoughtBlocksCount: thoughtBlocks.length,
        totalThoughtLen,
        duplicationRatio: Math.round(duplicationRatio * 100) / 100
      }
    }
  }
}
