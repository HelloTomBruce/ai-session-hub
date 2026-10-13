import { ValueScoringEngine, type ValueScoringEngineOptions } from './scoring-engine.js'
import type { EvaluationContext, QuantitativeEvaluationReport } from './types.js'

export * from './types.js'
export * from './rubric-config.js'
export * from './scoring-engine.js'
export * from './evidence/normalize.js'
export * from './evidence/tool-profiles.js'
export * from './strategies/change-impact-evaluator.js'
export * from './strategies/reasoning-density-evaluator.js'
export * from './strategies/execution-quality-evaluator.js'
export * from './strategies/llm-judge-evaluator.js'
export * from './compactor.js'
// LLM 客户端已抽为独立包 @session-hub/llm；此处 re-export 保持既有消费者兼容
export { streamLLMCompletion, type StreamChunkCallback } from '@session-hub/llm'
export { completeLLM, extractJsonFromLLMText } from '@session-hub/llm'
export type { LLMProviderSettings } from '@session-hub/llm'
export * from './distill/types.js'
export * from './distill/engine.js'
export * from './diagnose/types.js'
export * from './diagnose/rubric.js'

let defaultEngine: ValueScoringEngine | null = null

/**
 * 评估会话的量化价值。默认引擎为单例；传入 options 时使用一次性引擎。
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
