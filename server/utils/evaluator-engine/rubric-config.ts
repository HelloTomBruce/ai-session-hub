export interface EvaluatorEngineConfig {
  weights: {
    astImpact: number
    informationDensity: number
    topologyCentrality: number
    llmJudgeQuality: number
  }
  thresholds: {
    worthSavingScore: number      // Minimum overall score to recommend saving (default 75)
    gradeS: number                // S Grade (default 90)
    gradeA: number                // A Grade (default 75)
    gradeB: number                // B Grade (default 60)
    adrCategoryThreshold: number  // Score to classify as ADR (default 85)
    gotchaCategoryThreshold: number // Score to classify as Gotcha (default 75)
    patternCategoryThreshold: number // Score to classify as Pattern (default 60)
  }
}

export const DEFAULT_EVALUATOR_CONFIG: EvaluatorEngineConfig = {
  weights: {
    astImpact: 0.35,
    informationDensity: 0.35,
    topologyCentrality: 0.30,
    llmJudgeQuality: 0.40 // Dynamic if LLM is enabled
  },
  thresholds: {
    worthSavingScore: 70,
    gradeS: 88,
    gradeA: 72,
    gradeB: 55,
    adrCategoryThreshold: 75,
    gotchaCategoryThreshold: 70,
    patternCategoryThreshold: 55
  }
}
