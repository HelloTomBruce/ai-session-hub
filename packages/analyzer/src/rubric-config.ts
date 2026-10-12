/**
 * Rubric v2 —— 评分权重与全部阈值的唯一事实源
 *
 * 权重采用「份额制」：静态三策略份额合计 1.0；LLM 裁判启用时
 * 静态份额整体压缩为 staticScaleWhenLlm（默认 0.6），LLM 占 1 - 0.6 = 0.4。
 */
export interface EvaluatorEngineConfig {
  shares: {
    changeImpact: number
    reasoningDensity: number
    executionQuality: number
    llmJudge: number
    /** LLM 裁判参与时，静态三策略份额的总缩放系数 */
    staticScaleWhenLlm: number
  }
  thresholds: {
    // 评级（注意：与入库线保持显式区分）
    gradeS: number
    gradeA: number
    gradeB: number
    /** 入库沉淀线，默认与 gradeA 对齐：不入库 B 级资产 */
    worthSaving: number
    /** 低于该分且未被更高分类捕获时归为 Trivial */
    trivialMax: number
    adr: {
      minOverall: number
      minChange: number
      requireContract: boolean
    }
    gotcha: {
      minOverall: number
      minReasoning: number
      /** 高推理密度例外：外科手术式小修复总分可能不高，但根因证据价值高 */
      minReasoningHigh: number
      /** 必须携带结构化根因/避坑信号（带证据），裸关键词不可触发 */
      requireEvidence: boolean
    }
    pattern: {
      minOverall: number
    }
    milestone: {
      minOverall: number
      minChange: number
      minExecution: number
    }
  }
  /** 结构化 veto flags 命中数达到该值即否决（高置信 LLM unresolved 另算，P2 实现） */
  veto: {
    minFlags: number
  }
}

export const DEFAULT_EVALUATOR_CONFIG: EvaluatorEngineConfig = {
  shares: {
    changeImpact: 0.35,
    reasoningDensity: 0.35,
    executionQuality: 0.30,
    llmJudge: 0.40,
    staticScaleWhenLlm: 0.6
  },
  thresholds: {
    gradeS: 88,
    gradeA: 72,
    gradeB: 58,
    worthSaving: 72,
    trivialMax: 55,
    adr: { minOverall: 72, minChange: 70, requireContract: true },
    gotcha: { minOverall: 68, minReasoning: 65, minReasoningHigh: 72, requireEvidence: true },
    pattern: { minOverall: 62 },
    milestone: { minOverall: 62, minChange: 45, minExecution: 55 }
  },
  veto: {
    minFlags: 2
  }
}
