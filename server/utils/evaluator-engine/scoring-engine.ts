import type {
  EvaluationContext,
  IEvaluatorStrategy,
  QuantitativeEvaluationReport,
  StrategyScoreResult,
  ValueCategory,
  GradeLevel,
  SuggestedAction
} from './types'
import { DEFAULT_EVALUATOR_CONFIG, type EvaluatorEngineConfig } from './rubric-config'
import { AstImpactEvaluator } from './strategies/ast-impact-evaluator'
import { EntropyDensityEvaluator } from './strategies/entropy-density-evaluator'
import { TopologyCentralityEvaluator } from './strategies/topology-centrality-evaluator'
import { LlmJudgeEvaluator } from './strategies/llm-judge-evaluator'
import type { LLMProviderSettings } from '../llm-provider-config'

export interface ValueScoringEngineOptions {
  strategies?: IEvaluatorStrategy[]
  config?: EvaluatorEngineConfig
  llmProvider?: LLMProviderSettings
}

/**
 * Highly modular & independent value evaluation engine
 */
export class ValueScoringEngine {
  private strategies: IEvaluatorStrategy[] = []
  private config: EvaluatorEngineConfig

  constructor(options: ValueScoringEngineOptions = {}) {
    this.config = options.config || DEFAULT_EVALUATOR_CONFIG

    if (options.strategies && options.strategies.length > 0) {
      this.strategies = options.strategies
    } else {
      // Default standard pipeline
      this.strategies = [
        new AstImpactEvaluator(),
        new EntropyDensityEvaluator(),
        new TopologyCentralityEvaluator()
      ]

      if (options.llmProvider) {
        this.strategies.push(new LlmJudgeEvaluator(options.llmProvider))
      }
    }
  }

  /**
   * Register or replace a strategy dynamically
   */
  registerStrategy(strategy: IEvaluatorStrategy): this {
    const existingIdx = this.strategies.findIndex(s => s.name === strategy.name)
    if (existingIdx >= 0) {
      this.strategies[existingIdx] = strategy
    } else {
      this.strategies.push(strategy)
    }
    return this
  }

  /**
   * Run the evaluation pipeline
   */
  async evaluate(ctx: EvaluationContext): Promise<QuantitativeEvaluationReport> {
    const activeResults: StrategyScoreResult[] = []
    let weightedSum = 0
    let totalWeight = 0

    // Execute each available strategy in parallel
    const evaluations = await Promise.all(
      this.strategies
        .filter(s => s.isAvailable())
        .map(s => s.evaluate(ctx))
    )

    for (const res of evaluations) {
      activeResults.push(res)
      const w = res.weight > 0 ? res.weight : 0.1
      weightedSum += res.rawScore * w
      totalWeight += w
    }

    const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0
    const allSignals = activeResults.flatMap(r => r.signals)

    // Check Veto Conditions (Thrashing + Tool Friction or AI Judge Unresolved)
    const llmRes = activeResults.find(r => r.strategyName === 'llm-judge')
    const hasThrashing = allSignals.some(s => s.includes('Thrashing') || s.includes('思维链严重膨胀'))
    const hasToolFriction = allSignals.some(s => s.includes('盲搜死循环') || s.includes('工具调用摩擦'))
    const isLlmVetoed = llmRes && llmRes.details && (llmRes.details.isTaskResolved === false || llmRes.details.isHighValue === false)

    const isVetoed = isLlmVetoed || (hasThrashing && hasToolFriction)

    // 1. Determine Grade Level
    let grade: GradeLevel = 'C'
    if (!isVetoed) {
      if (overallScore >= this.config.thresholds.gradeS) grade = 'S'
      else if (overallScore >= this.config.thresholds.gradeA) grade = 'A'
      else if (overallScore >= this.config.thresholds.gradeB) grade = 'B'
    } else {
      grade = overallScore >= 60 ? 'B' : 'C'
    }

    // 2. Determine Value Category
    let category: ValueCategory = 'Trivial'
    const astRes = activeResults.find(r => r.strategyName === 'ast-impact')
    const entropyRes = activeResults.find(r => r.strategyName === 'entropy-density')
    const astScore = astRes?.rawScore || 0
    const entropyScore = entropyRes?.rawScore || 0
    const hasContractChange = Boolean(astRes?.details?.hasContractChange)
    const hasRootCauseOrGotcha = entropyRes?.signals?.some(s => s.includes('根因') || s.includes('避坑') || s.includes('注意点'))

    if (!isVetoed) {
      if (astScore >= 75 && (hasContractChange || overallScore >= this.config.thresholds.adrCategoryThreshold)) {
        category = 'ADR'
      } else if (hasRootCauseOrGotcha || (entropyScore >= 75 && overallScore >= this.config.thresholds.gotchaCategoryThreshold)) {
        category = 'Gotcha'
      } else if (overallScore >= this.config.thresholds.patternCategoryThreshold) {
        category = 'Pattern'
      } else if (astScore >= 50 && entropyScore >= 50) {
        category = 'Milestone'
      }
    } else {
      category = 'Trivial'
    }

    // 3. Core Decision: Is Worth Saving?
    const isWorthSaving = !isVetoed && overallScore >= this.config.thresholds.worthSavingScore

    // 4. Suggested Action
    let suggestedAction: SuggestedAction = 'search_index_only'
    if (isWorthSaving) {
      if (category === 'ADR') suggestedAction = 'auto_archive_adr'
      else if (category === 'Gotcha') suggestedAction = 'save_as_gotcha'
      else if (category === 'Pattern') suggestedAction = 'save_as_pattern'
      else suggestedAction = 'include_in_weekly'
    } else if (overallScore >= 55 && !isVetoed) {
      suggestedAction = 'include_in_weekly'
    }

    // 5. Aggregate Signals & Explanations
    const summaryReason = this.buildSummaryReason(overallScore, grade, category, isWorthSaving, isVetoed, allSignals)

    return {
      sessionId: ctx.sessionId,
      overallScore,
      grade,
      category,
      isWorthSaving,
      suggestedAction,
      subScores: {
        astImpact: astScore,
        informationDensity: entropyScore,
        topologyCentrality: activeResults.find(r => r.strategyName === 'topology-centrality')?.rawScore || 0,
        llmJudgeQuality: activeResults.find(r => r.strategyName === 'llm-judge')?.rawScore
      },
      signals: allSignals,
      summaryReason,
      evaluatedAt: Date.now()
    }
  }

  private buildSummaryReason(
    score: number,
    grade: GradeLevel,
    category: ValueCategory,
    isWorthSaving: boolean,
    isVetoed: boolean,
    signals: string[]
  ): string {
    if (isVetoed) {
      return `【未入库 · ${category}】检测到会话存在思维链空转、盲搜死循环或未闭环停滞，不符合知识资产沉淀标准（已保留搜索索引）。`
    }
    if (isWorthSaving) {
      return `【${grade} 级 · ${category} 资产】综合评定分 ${score} 分。${signals.slice(0, 2).join('；')}。推荐沉淀入知识库。`
    }
    return `【${grade} 级 · ${category}】综合评定分 ${score} 分。${signals[0] || '属于常规问答或局部小改动'}。建议保留搜索索引。`
  }
}
