export type ValueCategory = 'ADR' | 'Gotcha' | 'Pattern' | 'Milestone' | 'Trivial'
export type GradeLevel = 'S' | 'A' | 'B' | 'C'
export type SuggestedAction = 'auto_archive_adr' | 'save_as_gotcha' | 'save_as_pattern' | 'include_in_weekly' | 'search_index_only'

/**
 * Standard input context for evaluation engine (fully decoupled from any UI/DB)
 */
export interface EvaluationContext {
  sessionId: string
  platform: string
  title: string
  cwd?: string
  createdAt?: number
  updatedAt?: number
  messages: Array<{
    role: 'user' | 'assistant' | 'system' | 'tool' | string
    content: string
    thought?: string
    toolCalls?: Array<{
      name?: string
      type?: string
      arguments?: any
      args?: any
      input?: any
      output?: any
    }>
  }>
  gitDiffs?: Array<{
    filePath: string
    patch?: string
    addedLines?: number
    deletedLines?: number
  }>
}

/**
 * Single strategy output
 */
export interface StrategyScoreResult {
  strategyName: string
  rawScore: number          // 0 ~ 100
  weight: number            // 0 ~ 1.0
  confidence: number        // 0 ~ 1.0 (confidence of the judgment)
  signals: string[]         // Positive/Negative detected signals and evidence
  details?: Record<string, any>
}

/**
 * Final quantitative evaluation report
 */
export interface QuantitativeEvaluationReport {
  sessionId: string
  overallScore: number       // 0 ~ 100 (weighted aggregate score)
  grade: GradeLevel          // S (90+), A (75-89), B (60-74), C (<60)
  category: ValueCategory    // Main detected value category
  isWorthSaving: boolean     // Core decision boolean
  suggestedAction: SuggestedAction
  subScores: {
    astImpact: number
    informationDensity: number
    topologyCentrality: number
    llmJudgeQuality?: number
  }
  signals: string[]          // Key rationale signals detected
  summaryReason: string      // Human-readable summary explanation
  evaluatedAt: number
}

/**
 * Pluggable strategy interface
 */
export interface IEvaluatorStrategy {
  readonly name: string
  readonly defaultWeight: number
  isAvailable(): boolean
  evaluate(ctx: EvaluationContext): Promise<StrategyScoreResult>
}
