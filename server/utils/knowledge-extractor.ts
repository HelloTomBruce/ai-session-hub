/**
 * 评估引导的知识抽取（Rubric v2 / P3 → P1 统一管线薄壳）：
 * worth-saving 评估通过后，把评估结论转换为抽取引导（guidance），
 * 委托统一抽取器 memory-extractor 执行——prompt 与证据锚定的单一事实源在那里。
 */
import type { MemoryGraphItem } from './memory-types'
import type { UnifiedSession, SessionMessage } from './types'
import type { QuantitativeEvaluationReport } from '@session-hub/analyzer'
import { extractMemoryFromSession, buildMessagesContent, CATEGORY_GUIDANCE, type ExtractedMemory } from './memory-extractor'
import type { StreamChunkCallback } from '@session-hub/llm'

export interface KnowledgeExtractInput {
  session: UnifiedSession
  messages: SessionMessage[]
  report: QuantitativeEvaluationReport
  userInstructions?: string
}

/**
 * 执行抽取，返回带证据校验结果的记忆草稿（未落库）。未配置 LLM 时抛错，
 * 由调用方决定 candidate 态。
 */
export async function extractKnowledgeFromEvaluation(
  input: KnowledgeExtractInput,
  onProgress?: StreamChunkCallback
): Promise<ExtractedMemory> {
  const { session, messages, report } = input
  const categoryGuidance = CATEGORY_GUIDANCE[report.category]
    || '- 按最贴切的工程知识类型组织 content，背景/做法/边界清晰分段。'

  const guidance = `
【量化评估结论（作为抽取重点的引导，不是要复述的内容）】
- 分类：${report.category}；评级：${report.grade}；总分：${report.overallScore}
- 评估信号：${report.signals.slice(0, 6).join('；')}
${categoryGuidance}`.trim()

  const extracted = await extractMemoryFromSession(
    {
      sessionTitle: session.title,
      cwd: session.cwd,
      platform: session.cli,
      messagesContent: buildMessagesContent(messages),
      userInstructions: input.userInstructions,
      guidance
    },
    onProgress
  )

  // 评估溯源信息补充进 sourceMeta
  const sourceMeta: MemoryGraphItem['sourceMeta'] = {
    ...extracted.sourceMeta,
    sessionId: session.id,
    sessionTitle: session.title,
    score: report.overallScore,
    grade: report.grade,
    category: report.category,
    evaluatorVersion: report.evaluatorVersion || 2,
    evidenceVerified: extracted.evidenceVerified
  }

  return {
    ...extracted,
    // 证据锚定处置：有引文但全部校验失败 → 视为编造嫌疑，显著降置信
    confidence: extracted.evidenceVerified.total > 0 && extracted.evidenceVerified.passed === 0
      ? Math.min(extracted.confidence ?? 90, 45)
      : extracted.confidence,
    sourceMeta
  }
}
