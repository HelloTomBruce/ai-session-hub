/**
 * 评估引擎类型契约（Rubric v2）
 *
 * 信号为结构化对象（code/polarity/message/evidence），聚合引擎不再
 * 通过匹配中文文案来做 veto 判定；veto 完全依据策略置的 flags。
 */
export type ValueCategory = 'ADR' | 'Gotcha' | 'Pattern' | 'Milestone' | 'Trivial'

// S: >= gradeS; A: >= gradeA; B: >= gradeB; C: 其余
export type GradeLevel = 'S' | 'A' | 'B' | 'C'

export type SuggestedAction
  = | 'auto_archive_adr'
    | 'save_as_gotcha'
    | 'save_as_pattern'
    | 'include_in_weekly'
    | 'search_index_only'

/** 交互轮次（以 user 消息切分） */
export interface Turn {
  index: number
  userText: string
  assistantTexts: string[]
  hasToolUse: boolean
}

/**
 * 标准输入上下文（与 UI/DB 解耦）
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
      arguments?: unknown
      args?: unknown
      input?: unknown
      [key: string]: unknown
    }>
  }>
  /** 预计算证据（可选，单测可注入；正常由证据归一化层产出） */
  evidence?: import('./evidence/normalize.js').EvaluationEvidence
  /** 真实 git diff（暂无数据源，留作未来通道）@internal */
  gitDiffs?: Array<{
    filePath: string
    patch?: string
    addedLines?: number
    deletedLines?: number
  }>
}

/** 结构化信号 */
export interface Signal {
  /** 机器可读信号码，如 CONTRACT_TYPE_CHANGE / SEARCH_LOOP */
  code: string
  polarity: 'positive' | 'negative' | 'neutral'
  /** 仅用于前端展示 */
  message: string
  /** 命中片段或数值证据 */
  evidence?: string
}

/** 策略可置的否决标志位，聚合只认 flags 不认文案 */
export interface StrategyFlags {
  /** 思维链空转/反复重试 */
  thrashing?: boolean
  /** 盲搜死循环：大量搜索零编辑或读写比严重失衡 */
  searchLoop?: boolean
  /** 任务未闭环：停在报错上、无结论交付 */
  unresolved?: boolean
}

/**
 * 单策略输出
 */
export interface StrategyScoreResult {
  strategyName: string
  rawScore: number // 0 ~ 100
  confidence: number // 0.5 ~ 1，聚合实际使用
  signals: Signal[]
  flags?: StrategyFlags
  details?: Record<string, unknown>
}

/**
 * 最终量化评估报告
 */
export interface QuantitativeEvaluationReport {
  sessionId: string
  overallScore: number // 0 ~ 100（confidence 加权平均）
  grade: GradeLevel
  category: ValueCategory
  isWorthSaving: boolean
  vetoed: boolean
  lowConfidence: boolean
  suggestedAction: SuggestedAction
  subScores: {
    changeImpact: number
    reasoningDensity: number
    executionQuality: number
    llmJudgeQuality?: number
  }
  /** 结构化信号明细 */
  signalDetails: Signal[]
  /** 兼容旧消费方（knowledge-service / 前端字符串展示） */
  signals: string[]
  flags: StrategyFlags
  summaryReason: string
  evaluatorVersion: number
  evaluatedAt: number
  /** 持久化层回填：沉淀状态（candidate/extracted/skipped）与 Grafeo 节点 id */
  harvestStatus?: string
  memoryNodeId?: string
}

/**
 * 可插拔策略接口。evidence 由引擎预计算并传入，避免各策略重复解析。
 */
export interface IEvaluatorStrategy {
  readonly name: string
  evaluate(ctx: EvaluationContext, evidence: import('./evidence/normalize.js').EvaluationEvidence): Promise<StrategyScoreResult>
  isAvailable(): boolean
}
