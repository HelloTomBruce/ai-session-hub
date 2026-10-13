import { streamText, APICallError } from 'ai'
import type { LLMProviderSettings } from './types.js'
import { markEndpointLimitFrom400, modelKeyOf, remembersNoTemperature } from './compat.js'
import { makeChatModel } from './model.js'

export interface StreamChunkCallback {
  (chunk: string): void
}

export interface StreamLLMOptions {
  /** 采样温度，默认 0.2 */
  temperature?: number
  /** 建立连接与流读取超时（毫秒），默认 120_000 */
  timeoutMs?: number
}

/**
 * Streams LLM completion chunks from any OpenAI-compatible endpoint（基于 Vercel AI SDK）。
 * Returns the complete concatenated text once finished.
 */
export async function streamLLMCompletion(
  provider: LLMProviderSettings,
  systemPrompt: string,
  userPrompt: string,
  onChunk: StreamChunkCallback,
  temperature = 0.2,
  options?: { timeoutMs?: number }
): Promise<string> {
  const modelKey = modelKeyOf(provider)
  const timeoutMs = options?.timeoutMs ?? 120_000

  const run = async (withTemperature: boolean): Promise<string> => {
    const result = streamText({
      model: makeChatModel(provider),
      system: systemPrompt,
      prompt: userPrompt,
      temperature: withTemperature ? temperature : undefined,
      abortSignal: AbortSignal.timeout(timeoutMs),
      maxRetries: 0
    })

    let fullText = ''
    for await (const chunk of result.textStream) {
      fullText += chunk
      onChunk(chunk)
    }
    return fullText
  }

  try {
    return await run(!remembersNoTemperature(modelKey))
  } catch (err) {
    // 端点拒绝自定义 temperature（400）时去掉重试，并进共享记忆（流式/非流式通用）
    if (err instanceof APICallError && err.statusCode === 400) {
      const errText = `${err.message} ${err.responseBody ?? ''}`
      if (markEndpointLimitFrom400(modelKey, errText)) {
        return await run(false)
      }
    }
    throw err
  }
}
