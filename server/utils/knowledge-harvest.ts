/**
 * 沉淀编排：LLM 真实抽取 / 手工捕获 → Grafeo 记忆图谱写入。
 * P1 起去重与演进链统一收敛到 memoryService.saveMemoryWithDedup（全路径共享）。
 */
import { memoryService } from './memory-service'
import { extractKnowledgeFromEvaluation } from './knowledge-extractor'
import type { MemoryGraphItem, MemoryNodeData, ProjectEntity } from './memory-types'
import type { UnifiedSession, SessionMessage } from './types'
import type { QuantitativeEvaluationReport } from '@session-hub/analyzer'

export interface HarvestInput {
  session: UnifiedSession
  messages: SessionMessage[]
  report: QuantitativeEvaluationReport
}

export interface HarvestResult {
  status: 'extracted' | 'candidate'
  item?: MemoryGraphItem
  dedup?: 'created' | 'updated-session' | 'updated-title' | 'superseded'
  reason?: string
}

export interface ManualInsightInput {
  title: string
  type: 'ADR' | 'Gotcha' | 'Pattern' | 'Milestone'
  summary: string
  solution?: string
  consequence?: string
  tags?: string[]
  sessionId?: string
  platform?: string
  sessionTitle?: string
  cwd?: string
}

/**
 * 手工沉淀（MCP capture_session_insight、复盘页归档）正文拼装。纯函数，便于单测。
 */
export function buildManualContent(input: ManualInsightInput): string {
  const summary = (input.summary || '').trim()
  const solution = (input.solution || '').trim()
  const consequence = (input.consequence || '').trim()
  const sections: string[] = []

  if (summary)
    sections.push(`## 背景\n${summary}`)
  if (solution)
    sections.push(`## ${input.type === 'ADR' ? '决策' : '做法 / 方案'}\n${solution}`)
  if (consequence)
    sections.push(`## 结果与影响\n${consequence}`)

  return sections.join('\n\n')
}

type PersistDraft = Partial<MemoryGraphItem> & {
  title: string
  content: string
  sourceMeta: MemoryNodeData['sourceMeta']
}

class KnowledgeHarvestService {
  /**
   * 评估引导沉淀。未配置 LLM 或抽取失败时返回 candidate（不落任何假资产）。
   */
  async harvest(input: HarvestInput, onChunk?: (chunk: string) => void): Promise<HarvestResult> {
    const { session, report } = input

    const draft = await extractKnowledgeFromEvaluation(
      { session, messages: input.messages, report },
      onChunk
    )

    if (!draft.content || !draft.title) {
      return { status: 'candidate', reason: 'LLM 未抽取出有效知识内容' }
    }

    const sourceMeta: MemoryNodeData['sourceMeta'] = {
      platform: session.cli,
      sessionId: session.id,
      sessionTitle: session.title,
      score: report.overallScore,
      grade: report.grade,
      category: report.category,
      evaluatorVersion: report.evaluatorVersion || 2,
      extractedAt: Date.now()
    }

    const projects: ProjectEntity[] = draft.projects?.length
      ? draft.projects
      : (session.cwd ? [{ name: session.cwd.split('/').pop() || 'project', cwd: session.cwd }] : [])

    return this.persistDraft(
      {
        ...draft,
        title: draft.title,
        content: draft.content,
        sourceMeta,
        projects
      },
      { sessionId: session.id, platform: session.cli }
    )
  }

  /**
   * 手工捕获经验资产（MCP / 复盘页归档）：不经 LLM 抽取直接落 Grafeo，
   * 与评估沉淀共用同一套去重与演进链，knowledge_vault 不再接收写入。
   */
  async captureManual(input: ManualInsightInput): Promise<HarvestResult> {
    const content = buildManualContent(input)
    if (!content) {
      return { status: 'candidate', reason: 'summary、solution 均为空，未形成有效知识内容' }
    }

    return this.persistDraft(
      {
        title: input.title,
        content,
        type: input.type,
        summary: input.summary || input.title,
        tags: input.tags || [],
        projects: input.cwd
          ? [{ name: input.cwd.split('/').pop() || 'project', cwd: input.cwd }]
          : [],
        sourceMeta: {
          platform: input.platform,
          sessionId: input.sessionId,
          sessionTitle: input.sessionTitle,
          evaluatorVersion: 2,
          extractedAt: Date.now(),
          extra: { source: 'manual-capture' }
        }
      },
      input.sessionId ? { sessionId: input.sessionId, platform: input.platform || '' } : undefined
    )
  }

  private async persistDraft(
    draft: PersistDraft,
    sessionKey?: { sessionId: string, platform: string }
  ): Promise<HarvestResult> {
    const { item, dedup } = await memoryService.saveMemoryWithDedup(draft, sessionKey)
    return { status: 'extracted', item, dedup }
  }
}

export const knowledgeHarvest = new KnowledgeHarvestService()
