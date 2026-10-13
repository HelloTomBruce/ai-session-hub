/**
 * 效能诊断契约：报告类型与存储接口（依赖注入，解耦宿主文件系统）。
 */
export interface AIEvaluationResult {
  score: number
  grade: 'S' | 'A' | 'B' | 'C'
  gradeLabel: string
  taskSummary: string
  taskCompletionStatus: 'Full' | 'Partial' | 'Failed' | 'Inconclusive'
  subScores: {
    directness: number
    decisionSoundness: number
    turnVelocity: number
    actionDensity: number
  }
  deductions: Array<{
    category: 'backtrack' | 'search_heavy' | 'command_error' | 'misunderstanding' | 'revert'
    turn: number
    title: string
    deductionPoints: number
    reason: string
    evidenceSnippet: string
  }>
  strengths: string[]
  bottlenecks: string[]
  prescriptions: string[]
  evaluatedAt: number
}

/**
 * 诊断报告存储契约。宿主实现文件落盘（~/.session-hub/diagnoses/{sessionId}.json）；
 * 测试可注入内存实现。文件存在 = 「已诊断」的唯一事实源。
 */
export interface ReportStore {
  save(sessionId: string, report: AIEvaluationResult): void
  load(sessionId: string): AIEvaluationResult | null
}
