import { generateObject, generateText, APICallError } from 'ai'
import { z } from 'zod'
import type { CompleteLLMOptions, LLMProviderSettings } from './types.js'
import { buildAttemptVariants, markEndpointLimitFrom400, modelKeyOf } from './compat.js'
import { makeChatModel } from './model.js'

// 透传 schema：任意键的 JSON 对象。jsonMode 语义由 generateObject 的
// 结构化输出机制（provider 自动选择 tool-calling / response_format）实现，
// 替代原手写 `response_format: { type: 'json_object' }` 参数。
const looseObjectSchema = z.looseObject({})

/**
 * 统一的非流式 LLM 补全入口（基于 Vercel AI SDK）。
 *
 * 行为契约（与 fetch 版一致）：
 * - 按「最完整 → 最裸」的参数组合依次尝试（temperature × jsonMode），
 *   已被端点拒绝的组合进共享记忆后直接跳过
 * - 仅 400（参数被拒）时降级重试；其他 HTTP 状态、网络错误直接抛出
 * - 默认 120s 超时（AbortSignal）
 * - 返回补全文本；jsonMode 路径返回 JSON.stringify 后的对象文本，
 *   解析请配合 extractJsonFromLLMText（generateObject 已校验过结构）
 */
export async function completeLLM(
  provider: LLMProviderSettings,
  systemPrompt: string,
  userPrompt: string,
  options: CompleteLLMOptions = {}
): Promise<string> {
  const modelKey = modelKeyOf(provider)
  const temperature = options.temperature ?? 0.2
  const jsonMode = options.jsonMode ?? true
  const timeoutMs = options.timeoutMs ?? 120_000

  const variantSig = (v: { temperature?: number, jsonMode: boolean }) =>
    `${v.temperature ?? 'none'}|${v.jsonMode}`
  const attempted = new Set<string>()

  let lastErr: unknown
  for (let guard = 0; guard < 4; guard++) {
    const variants = buildAttemptVariants(modelKey, temperature, jsonMode)
      .filter(v => !attempted.has(variantSig(v)))
    if (variants.length === 0) break
    const variant = variants[0]!
    attempted.add(variantSig(variant))

    const model = makeChatModel(provider)
    const shared = {
      model,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: variant.temperature,
      abortSignal: AbortSignal.timeout(timeoutMs),
      maxRetries: 0
    } as const

    try {
      if (variant.jsonMode) {
        const { object } = await generateObject({
          ...shared,
          schema: looseObjectSchema
        })
        return JSON.stringify(object)
      }
      const { text } = await generateText(shared)
      return text
    } catch (err) {
      if (err instanceof APICallError && err.statusCode === 400) {
        const errText = `${err.message} ${err.responseBody ?? ''}`
        if (markEndpointLimitFrom400(modelKey, errText)) {
          lastErr = err
          continue
        }
      }
      throw err
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error('LLM request failed after all parameter variants')
}
