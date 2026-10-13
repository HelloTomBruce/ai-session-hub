import { adapterRegistry } from '../../../../utils/adapter-registry'
import { EVALUATOR_SYSTEM_PROMPT, buildEvaluationPrompt, runDeterministicRubricEvaluation, type AIEvaluationResult } from '@session-hub/analyzer'
import { streamLLMCompletion } from '@session-hub/llm'
import { getLLMProviderSettings } from '../../../../utils/llm-provider-config'
import { fileReportStore } from '../../../../utils/diagnosis-service'
import type { PlatformType } from '../../../../utils/types'

export default defineEventHandler(async (event) => {
  const sessionId = getRouterParam(event, 'id')
  const query = getQuery(event)
  const platform = (query.cli as PlatformType) || 'agy'

  if (!sessionId) {
    throw createError({ statusCode: 400, message: 'Session ID is required' })
  }

  const { session, messages } = adapterRegistry.getMessages(platform, sessionId)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session ${sessionId} not found on ${platform}` })
  }

  // Set SSE Headers
  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')

  const res = event.node.res

  const sendEvent = (eventType: string, data: unknown) => {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const userPrompt = buildEvaluationPrompt(session, messages)
  const provider = getLLMProviderSettings()

  if (provider.enabled && provider.apiKey) {
    sendEvent('status', { message: `正在使用 ${provider.model || 'AI'} 进行深度效能推导诊断...` })
    try {
      const fullText = await streamLLMCompletion(
        provider,
        EVALUATOR_SYSTEM_PROMPT,
        userPrompt,
        (chunk: string) => {
          sendEvent('chunk', { text: chunk })
        },
        provider.temperature ?? 0.1
      )

      // Parse final JSON result
      let cleanedJson = fullText.trim()
      if (cleanedJson.startsWith('```')) {
        cleanedJson = cleanedJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
      }

      const parsed: AIEvaluationResult = JSON.parse(cleanedJson)
      parsed.evaluatedAt = Date.now()

      // Persist via injected report store
      fileReportStore.save(sessionId, parsed)

      sendEvent('done', {
        source: 'user_configured_llm',
        provider: {
          model: provider.model,
          baseUrl: provider.baseUrl
        },
        data: parsed
      })
      res.end()
      return
    } catch (err) {
      console.warn(`[Evaluator] Stream invocation failed:`, (err as { message?: string })?.message)
      sendEvent('status', { message: 'AI 流式调用中断，正在切换至本地规则引擎诊断...' })
    }
  }

  // Fallback to local rubric engine
  const fallbackResult = runDeterministicRubricEvaluation(session, messages)
  fileReportStore.save(sessionId, fallbackResult)

  sendEvent('done', {
    source: 'rubric_engine',
    data: fallbackResult
  })
  res.end()
})
