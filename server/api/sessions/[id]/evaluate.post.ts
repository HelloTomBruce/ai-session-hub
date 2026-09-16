import { evaluateSessionValue, type EvaluationContext } from '../../../utils/evaluator-engine'
import { knowledgeService } from '../../../utils/knowledge-service'
import { cacheService } from '../../../utils/cache-service'
import { getSessionMessages } from '../../../utils/session-service'
import { getLLMProviderSettings } from '../../../utils/llm-provider-config'
import type { PlatformType, UnifiedSession, SessionMessage } from '../../../utils/types'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const platform = (query.platform ? String(query.platform) : 'pi') as PlatformType
  const body = await readBody(event).catch(() => ({}))

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing session id' })
  }

  // 1. Get cached session or adapter session
  const detail = cacheService.getCachedSessionDetail(platform, id)
  let session: UnifiedSession | null = detail.session
  let messages: SessionMessage[] = detail.messages

  if (!session || messages.length === 0) {
    const raw = getSessionMessages(platform, id)
    if (!session && raw.session) session = raw.session
    if (messages.length === 0 && raw.messages) messages = raw.messages
  }

  if (!session) {
    session = {
      id,
      cli: platform,
      category: 'cli',
      title: body.title || '会话',
      cwd: body.cwd || process.cwd(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: messages.length,
      rawLocation: ''
    }
  }

  const activeSession: UnifiedSession = session

  // 2. Build Evaluation Context
  const evalCtx: EvaluationContext = {
    sessionId: activeSession.id,
    platform: activeSession.cli,
    title: activeSession.title,
    cwd: activeSession.cwd,
    createdAt: activeSession.createdAt,
    updatedAt: activeSession.updatedAt,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
      thought: m.thought,
      toolCalls: m.toolCalls
    }))
  }

  // 4. Run Evaluation Engine
  const llmProvider = getLLMProviderSettings()
  const report = await evaluateSessionValue(evalCtx, {
    llmProvider: llmProvider.enabled ? llmProvider : undefined
  })

  // 5. Save Evaluation Cache
  knowledgeService.saveEvaluation(report, activeSession.cli)

  // 6. Optional Auto-Harvest Knowledge
  let harvestedKnowledge = null
  if (body.autoHarvest || report.isWorthSaving) {
    harvestedKnowledge = knowledgeService.autoHarvestFromEvaluation(activeSession, report, messages)
  }

  return {
    success: true,
    data: report,
    harvestedKnowledge
  }
})
