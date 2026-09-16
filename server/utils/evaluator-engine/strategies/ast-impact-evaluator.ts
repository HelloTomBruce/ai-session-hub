import type { EvaluationContext, IEvaluatorStrategy, StrategyScoreResult } from '../types'

/**
 * Evaluates the depth and structural importance of code modifications (AST & Contract Impact)
 */
export class AstImpactEvaluator implements IEvaluatorStrategy {
  readonly name = 'ast-impact'
  readonly defaultWeight = 0.35

  isAvailable(): boolean {
    return true
  }

  async evaluate(ctx: EvaluationContext): Promise<StrategyScoreResult> {
    const signals: string[] = []
    let score = 20 // baseline

    // 1. Gather all file modifications from gitDiffs and toolCalls
    const modifiedFiles = new Set<string>()
    const codeDiffSnippets: string[] = []

    if (ctx.gitDiffs && ctx.gitDiffs.length > 0) {
      for (const diff of ctx.gitDiffs) {
        modifiedFiles.add(diff.filePath)
        if (diff.patch) codeDiffSnippets.push(diff.patch)
      }
    }

    // Also inspect tool calls for edit/write operations
    for (const msg of ctx.messages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          const name = (tc.name || tc.type || '').toLowerCase()
          if (name.includes('write') || name.includes('edit') || name.includes('replace') || name.includes('modify')) {
            const rawArgs = tc.arguments || tc.args || tc.input || {}
            const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>
            const targetPath = args.TargetFile || args.path || args.filePath || args.targetFile || ''
            if (targetPath) modifiedFiles.add(String(targetPath))
            if (args.CodeContent) codeDiffSnippets.push(String(args.CodeContent).slice(0, 500))
            if (args.ReplacementContent) codeDiffSnippets.push(String(args.ReplacementContent).slice(0, 500))
          }
        }
      }
    }

    const fileCount = modifiedFiles.size

    // Scenario A: Zero modifications
    if (fileCount === 0) {
      return {
        strategyName: this.name,
        rawScore: 15,
        weight: this.defaultWeight,
        confidence: 0.95,
        signals: ['未检测到实质性文件代码改动（纯对话或查询）'],
        details: { fileCount: 0 }
      }
    }

    signals.push(`累计修改 ${fileCount} 个关键文件`)
    if (fileCount >= 3) {
      score += 25
      signals.push('涉及跨多文件协同修改与模块联动')
    } else if (fileCount >= 1) {
      score += 15
    }

    // 2. Analyze code content for Structural / Contract Changes
    const allSnippets = codeDiffSnippets.join('\n')

    // High Impact Signals: Architecture, Contracts, Interfaces, Schemas, Configs
    const hasInterfaceOrType = /(export\s+)?(interface|type|enum)\s+[A-Z]/i.test(allSnippets)
    const hasClassOrAbstract = /(export\s+)?(abstract\s+)?class\s+[A-Z]/i.test(allSnippets)
    const hasSchemaOrConfig = /(defineNuxtConfig|defineAppConfig|createTable|schema|migration|package\.json|nuxt\.config)/i.test(allSnippets)
    const hasAsyncArchitecture = /(class\s+\w+Adapter|extends\s+Base|implements\s+I\w+)/i.test(allSnippets)

    // Medium Impact Signals: Logic & Error Handling
    const hasErrorHandling = /(try\s*\{|catch\s*\(|throw\s+new\s+Error|TimeoutError|Connect Timeout)/i.test(allSnippets)
    const hasStateOrLogic = /(ref\(|computed\(|useState|reactive\(|async\s+function|const\s+\w+\s*=\s*async)/i.test(allSnippets)

    // Low Impact Checks (Trivial tweaks)
    const isPureCommentOrStyle = /^\s*(\/\*|\/\/|\*|\s*color:|\s*padding:|\s*margin:)/m.test(allSnippets) && allSnippets.length < 150

    if (hasInterfaceOrType || hasClassOrAbstract || hasAsyncArchitecture) {
      score += 35
      signals.push('包含核心类型契约、接口定义或类继承架构变动')
    }

    if (hasSchemaOrConfig) {
      score += 25
      signals.push('包含工程核心配置或数据结构模型变更')
    }

    if (hasErrorHandling) {
      score += 15
      signals.push('包含异常保护、网络容错或排障修复逻辑')
    }

    if (hasStateOrLogic) {
      score += 10
    }

    if (isPureCommentOrStyle && score > 40) {
      score = 35
      signals.push('改动以局部样式或注释为主，结构权重适度回调')
    }

    const finalScore = Math.min(100, Math.max(10, score))

    return {
      strategyName: this.name,
      rawScore: finalScore,
      weight: this.defaultWeight,
      confidence: 0.9,
      signals,
      details: {
        fileCount,
        files: Array.from(modifiedFiles),
        hasContractChange: hasInterfaceOrType || hasClassOrAbstract,
        hasSchemaOrConfig,
        hasErrorHandling
      }
    }
  }
}
