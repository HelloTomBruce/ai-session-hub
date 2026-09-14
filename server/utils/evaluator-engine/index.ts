export * from './types'
export * from './rubric-config'
export * from './scoring-engine'
export * from './strategies/ast-impact-evaluator'
export * from './strategies/entropy-density-evaluator'
export * from './strategies/topology-centrality-evaluator'
export * from './strategies/llm-judge-evaluator'

import { ValueScoringEngine, type ValueScoringEngineOptions } from './scoring-engine'
import type { EvaluationContext, QuantitativeEvaluationReport } from './types'

// Singleton default engine instance
let defaultEngine: ValueScoringEngine | null = null

/**
 * Convenience entry point to evaluate a session's quantitative value
 */
export async function evaluateSessionValue(
  context: EvaluationContext,
  options?: ValueScoringEngineOptions
): Promise<QuantitativeEvaluationReport> {
  if (options) {
    const customEngine = new ValueScoringEngine(options)
    return customEngine.evaluate(context)
  }

  if (!defaultEngine) {
    defaultEngine = new ValueScoringEngine()
  }

  return defaultEngine.evaluate(context)
}
