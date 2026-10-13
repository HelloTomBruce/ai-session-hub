import { adapterRegistry } from '../../../utils/adapter-registry'
import { EVALUATOR_SYSTEM_PROMPT, buildEvaluationPrompt, runDeterministicRubricEvaluation, type AIEvaluationResult } from '@session-hub/analyzer'
import { completeLLM, extractJsonFromLLMText } from '@session-hub/llm'
import { getLLMProviderSettings } from '../../../utils/llm-provider-config'
import { fileReportStore } from '../../../utils/diagnosis-service'
import type { PlatformType } from '../../../utils/types'

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

  // 1. 构建标准 Prompt
  const userPrompt = buildEvaluationPrompt(session, messages)

  // 2. 读取用户配置的大模型 Provider 设置
  const provider = getLLMProviderSettings()

  if (provider.enabled && provider.apiKey) {
    try {
      const baseUrl = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
      const modelName = provider.model || 'gpt-4o-mini'

      // 统一 LLM 客户端：参数兼容降级（temperature/response_format）由 @session-hub/llm 管理
      const rawContent = await completeLLM(provider, EVALUATOR_SYSTEM_PROMPT, userPrompt, {
        temperature: provider.temperature ?? 0.1,
        jsonMode: true
      })

      // SAFETY: 诊断报告 JSON 结构由 EVALUATOR_SYSTEM_PROMPT 输出契约保证，字段渲染前端已容错
      const parsed = extractJsonFromLLMText(rawContent) as unknown as AIEvaluationResult
      parsed.evaluatedAt = Date.now()

      // Persist to local disk so it is remembered
      fileReportStore.save(sessionId, parsed)

      return {
        success: true,
        source: 'user_configured_llm',
        provider: {
          model: modelName,
          baseUrl
        },
        data: parsed
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[Evaluator] Invoking configured LLM (${provider.model} at ${provider.baseUrl}) failed: ${message}`)
    }
  }

  // 3. 本地确定性 Rubric 评估引擎（保底或离线运行）
  const fallbackResult = runDeterministicRubricEvaluation(session, messages)

  fileReportStore.save(sessionId, fallbackResult)

  return {
    success: true,
    source: 'rubric_engine',
    data: fallbackResult
  }
})

/**
 * 确定性 Rubric 评估引擎
 */
