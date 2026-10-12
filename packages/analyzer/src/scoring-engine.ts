/**
 * Rubric v2 聚合裁决：
 * - confidence 参与加权，缺失策略时权重重新归一化
 * - veto 只读结构化 flags（≥ minFlags 项）与 LLM 高置信 unresolved（需本地证据佐证）
 * - 评级/分类阈值全部来自 config，Milestone 可达
 */
import type {
  EvaluationContext,
  IEvaluatorStrategy,
  QuantitativeEvaluationReport,
  Signal,
  StrategyFlags,
  StrategyScoreResult,
  ValueCategory,
  GradeLevel,
  SuggestedAction
} from './types.js'
import { DEFAULT_EVALUATOR_CONFIG, type EvaluatorEngineConfig } from './rubric-config.js'
import { ChangeImpactEvaluator } from './strategies/change-impact-evaluator.js'
import { ReasoningDensityEvaluator } from './strategies/reasoning-density-evaluator.js'
import { ExecutionQualityEvaluator } from './strategies/execution-quality-evaluator.js'
import { LlmJudgeEvaluator } from './strategies/llm-judge-evaluator.js'
import { normalizeEvidence, type EvaluationEvidence } from './evidence/normalize.js'
import type { LLMProviderSettings } from './llm/types.js'

export interface ValueScoringEngineOptions {
  strategies?: IEvaluatorStrategy[]
  config?: EvaluatorEngineConfig
  llmProvider?: LLMProviderSettings
}

const STATIC_SHARE_KEY: Record<string, keyof EvaluatorEngineConfig['shares']> = {
  'change-impact': 'changeImpact',
  'reasoning-density': 'reasoningDensity',
  'execution-quality': 'executionQuality'
}

export class ValueScoringEngine {
  private strategies: IEvaluatorStrategy[] = []
  private config: EvaluatorEngineConfig

  constructor(options: ValueScoringEngineOptions = {}) {
    this.config = options.config || DEFAULT_EVALUATOR_CONFIG

    if (options.strategies && options.strategies.length > 0) {
      this.strategies = options.strategies
    } else {
      this.strategies = [
        new ChangeImpactEvaluator(),
        new ReasoningDensityEvaluator(),
        new ExecutionQualityEvaluator()
      ]
      if (options.llmProvider) {
        this.strategies.push(new LlmJudgeEvaluator(options.llmProvider))
      }
    }
  }

  registerStrategy(strategy: IEvaluatorStrategy): this {
    const idx = this.strategies.findIndex(s => s.name === strategy.name)
    if (idx >= 0) this.strategies[idx] = strategy
    else this.strategies.push(strategy)
    return this
  }

  async evaluate(ctx: EvaluationContext): Promise<QuantitativeEvaluationReport> {
    const evidence: EvaluationEvidence = ctx.evidence ?? normalizeEvidence(ctx)
    const active = this.strategies.filter(s => s.isAvailable())
    const results = await Promise.all(active.map(s => s.evaluate(ctx, evidence)))
    return this.aggregate(ctx, evidence, results.filter(r => r.confidence > 0))
  }

  /**
   * 分阶段执行（供 SSE 真实进度使用）：
   * evidence → 静态三策略 → LLM 裁判（可缺席/跳过）→ 聚合裁决
   */
  async evaluateStaged(
    ctx: EvaluationContext,
    hooks: {
      onEvidence?: (ev: EvaluationEvidence) => void
      onScoring?: () => void
      onJudge?: (status: 'running' | 'skipped' | 'unavailable', message?: string) => void
      onVerdict?: () => void
    } = {}
  ): Promise<{ report: QuantitativeEvaluationReport, evidence: EvaluationEvidence, evidenceHash?: string }> {
    const evidence: EvaluationEvidence = ctx.evidence ?? normalizeEvidence(ctx)
    hooks.onEvidence?.(evidence)

    const staticStrategies = this.strategies.filter(s => s.isAvailable() && s.name !== 'llm-judge')
    hooks.onScoring?.()
    const staticResults = await Promise.all(staticStrategies.map(s => s.evaluate(ctx, evidence)))

    const judge = this.strategies.find(s => s.name === 'llm-judge' && s.isAvailable())
    let judgeResult: StrategyScoreResult | undefined
    if (judge) {
      hooks.onJudge?.('running')
      judgeResult = await judge.evaluate(ctx, evidence)
      if (judgeResult.confidence === 0) {
        hooks.onJudge?.('unavailable', judgeResult.signals[0]?.message)
      }
    } else {
      hooks.onJudge?.('skipped')
    }

    const evaluated = [
      ...staticResults.filter(r => r.confidence > 0),
      ...(judgeResult && judgeResult.confidence > 0 ? [judgeResult] : [])
    ]

    hooks.onVerdict?.()
    const report = this.aggregate(ctx, evidence, evaluated)
    const evidenceHash = judgeResult?.details?.evidenceHash
      ? String(judgeResult.details.evidenceHash)
      : undefined
    return { report, evidence, evidenceHash }
  }

  private aggregate(
    ctx: EvaluationContext,
    evidence: EvaluationEvidence,
    evaluated: StrategyScoreResult[]
  ): QuantitativeEvaluationReport {
    // 份额计算：LLM 启用时静态份额压缩到 staticScaleWhenLlm
    const hasLlm = evaluated.some(r => r.strategyName === 'llm-judge')
    const scale = hasLlm ? this.config.shares.staticScaleWhenLlm : 1
    const shares = new Map<string, number>()
    for (const r of evaluated) {
      if (r.strategyName === 'llm-judge') {
        shares.set(r.strategyName, this.config.shares.llmJudge)
      } else {
        const key = STATIC_SHARE_KEY[r.strategyName]
        shares.set(r.strategyName, key ? this.config.shares[key] * scale : 0.1 * scale)
      }
    }

    let weightedSum = 0
    let weightTotal = 0
    for (const r of evaluated) {
      const w = (shares.get(r.strategyName) ?? 0.1) * r.confidence
      weightedSum += r.rawScore * w
      weightTotal += w
    }
    const overallScore = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0

    const allSignals: Signal[] = evaluated.flatMap(r => r.signals)
    const flags = this.collectFlags(evaluated)

    // LLM 高置信 unresolved veto：模型结论必须被本地证据佐证
    // （末轮报错 / 零编辑 / 无闭环），防止裁判被注入或误判否决高价值会话
    const llmRes = evaluated.find(r => r.strategyName === 'llm-judge')
    const llmClaimsUnresolved = Boolean(
      llmRes?.details
      && llmRes.details.resolved === false
      && llmRes.details.highValue === false
    )
    const localUnresolvedEvidence = Boolean(evidence.endsWithError)
      || evidence.metrics.editWriteCount === 0
      || !evidence.closedLoop
    const llmVeto = Boolean(
      llmRes
      && llmRes.confidence >= 0.8
      && llmClaimsUnresolved
      && localUnresolvedEvidence
    )
    const flagCount = [flags.thrashing, flags.searchLoop, flags.unresolved].filter(Boolean).length
    const vetoed = llmVeto || flagCount >= this.config.veto.minFlags

    // 评级
    const t = this.config.thresholds
    let grade: GradeLevel = 'C'
    if (!vetoed) {
      if (overallScore >= t.gradeS) grade = 'S'
      else if (overallScore >= t.gradeA) grade = 'A'
      else if (overallScore >= t.gradeB) grade = 'B'
    } else {
      grade = overallScore >= t.gradeB ? 'B' : 'C'
    }

    // 子分数
    const scoreOf = (name: string) => evaluated.find(r => r.strategyName === name)?.rawScore ?? 0
    const changeScore = scoreOf('change-impact')
    const reasoningScore = scoreOf('reasoning-density')
    const executionScore = scoreOf('execution-quality')
    const llmScore = evaluated.find(r => r.strategyName === 'llm-judge')?.rawScore

    // 分类（全部带分数 + 证据双条件，Milestone 可达）
    const reasoning = evaluated.find(r => r.strategyName === 'reasoning-density')
    const change = evaluated.find(r => r.strategyName === 'change-impact')
    const hasContractChange = Boolean(change?.details?.hasContractChange)
    const hasGotchaEvidence = Boolean(reasoning?.signals.some(
      s => (s.code === 'ROOT_CAUSE' || s.code === 'GOTCHA_WARNING') && Boolean(s.evidence)
    ))
    const hasReuseSignal = Boolean(evidence.closedLoop)

    const category = this.classify({
      vetoed,
      overallScore,
      changeScore,
      reasoningScore,
      executionScore,
      hasContractChange,
      hasGotchaEvidence,
      hasReuseSignal
    })

    const highValueGotcha = category === 'Gotcha'
      && Boolean(reasoning?.signals.some(x => x.code === 'ROOT_CAUSE' && x.evidence))
      && reasoningScore >= t.gotcha.minReasoningHigh
    const isWorthSaving = !vetoed
      && category !== 'Trivial'
      && (overallScore >= t.worthSaving || highValueGotcha)

    let suggestedAction: SuggestedAction = 'search_index_only'
    if (isWorthSaving) {
      if (category === 'ADR') suggestedAction = 'auto_archive_adr'
      else if (category === 'Gotcha') suggestedAction = 'save_as_gotcha'
      else if (category === 'Pattern') suggestedAction = 'save_as_pattern'
      else suggestedAction = 'include_in_weekly'
    } else if (overallScore >= t.gradeB && !vetoed) {
      suggestedAction = 'include_in_weekly'
    }

    const lowConfidence = evaluated.filter(r => r.strategyName !== 'llm-judge').length < 2

    return {
      sessionId: ctx.sessionId,
      overallScore,
      grade,
      category,
      isWorthSaving,
      vetoed,
      lowConfidence,
      suggestedAction,
      subScores: {
        changeImpact: changeScore,
        reasoningDensity: reasoningScore,
        executionQuality: executionScore,
        llmJudgeQuality: llmScore
      },
      signalDetails: allSignals,
      signals: allSignals.map(s => s.message),
      flags,
      summaryReason: this.buildSummaryReason(overallScore, grade, category, isWorthSaving, vetoed, allSignals),
      evaluatorVersion: 2,
      evaluatedAt: Date.now()
    }
  }

  private collectFlags(results: StrategyScoreResult[]): StrategyFlags {
    const merged: StrategyFlags = {}
    for (const r of results) {
      if (r.flags?.thrashing) merged.thrashing = true
      if (r.flags?.searchLoop) merged.searchLoop = true
      if (r.flags?.unresolved) merged.unresolved = true
    }
    return merged
  }

  private classify(input: {
    vetoed: boolean
    overallScore: number
    changeScore: number
    reasoningScore: number
    executionScore: number
    hasContractChange: boolean
    hasGotchaEvidence: boolean
    hasReuseSignal: boolean
  }): ValueCategory {
    if (input.vetoed) return 'Trivial'
    const t = this.config.thresholds

    if (input.overallScore >= t.adr.minOverall
      && input.changeScore >= t.adr.minChange
      && (!t.adr.requireContract || input.hasContractChange)) {
      return 'ADR'
    }
    if ((input.overallScore >= t.gotcha.minOverall
      || (input.hasGotchaEvidence && input.reasoningScore >= t.gotcha.minReasoningHigh))
    && input.reasoningScore >= t.gotcha.minReasoning
    && (!t.gotcha.requireEvidence || input.hasGotchaEvidence)) {
      return 'Gotcha'
    }
    if (input.overallScore >= t.pattern.minOverall && input.hasReuseSignal) {
      return 'Pattern'
    }
    if (input.overallScore >= t.milestone.minOverall
      && input.changeScore >= t.milestone.minChange
      && input.executionScore >= t.milestone.minExecution) {
      return 'Milestone'
    }
    if (input.overallScore < t.trivialMax) return 'Trivial'
    return 'Pattern'
  }

  private buildSummaryReason(
    score: number,
    grade: GradeLevel,
    category: ValueCategory,
    isWorthSaving: boolean,
    isVetoed: boolean,
    signals: Signal[]
  ): string {
    if (isVetoed) {
      return '【未入库 · Trivial】检测到思维链空转、盲搜死循环或未闭环停滞（结构化 flags 触发），不符合知识资产沉淀标准（已保留搜索索引）。'
    }
    if (isWorthSaving) {
      return `【${grade} 级 · ${category} 资产】综合评定分 ${score} 分。${signals.slice(0, 2).map(s => s.message).join('；')}。推荐沉淀入知识库。`
    }
    return `【${grade} 级 · ${category}】综合评定分 ${score} 分。${signals[0]?.message || '属于常规问答或局部小改动'}。建议保留搜索索引。`
  }
}
