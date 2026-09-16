import type { LLMProviderSettings } from './llm-provider-config'

export interface StreamChunkCallback {
  (chunk: string): void
}

// 已知不接受自定义 temperature 的模型（如 kimi-for-coding、o 系列），
// 进程内记住后后续请求直接不传，避免每次都先撞一次 400 再重试
const temperatureRejectedModels = new Set<string>()

/**
 * Streams LLM completion chunks from any OpenAI-compatible endpoint.
 * Returns the complete concatenated text once finished.
 */
export async function streamLLMCompletion(
  provider: LLMProviderSettings,
  systemPrompt: string,
  userPrompt: string,
  onChunk: StreamChunkCallback,
  temperature = 0.2
): Promise<string> {
  const baseUrl = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const model = provider.model || 'gpt-4o-mini'
  const modelKey = `${baseUrl}|${model}`

  const reqBody: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    stream: true,
    ...(temperatureRejectedModels.has(modelKey) ? {} : { temperature })
  }

  const doRequest = (body: Record<string, unknown>) => fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  let res = await doRequest(reqBody)

  if (!res.ok) {
    const errText = await res.text()
    // 部分模型（如 kimi-for-coding、o 系列）不允许自定义 temperature，
    // 遇到此类 400 错误时移除 temperature 参数重试，交由服务端默认值处理
    if (res.status === 400 && /temperature/i.test(errText)) {
      temperatureRejectedModels.add(modelKey)
      console.info(`[LLM Stream] Model ${model} does not accept custom temperature, omitting it from now on`)
      const { temperature: _omit, ...bodyWithoutTemp } = reqBody
      res = await doRequest(bodyWithoutTemp)
    }
    if (!res.ok) {
      const finalErr = await res.text()
      throw new Error(`LLM API responded with ${res.status}: ${finalErr || errText}`)
    }
  }

  if (!res.body) {
    throw new Error('No readable stream from LLM endpoint')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let fullText = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith(':')) continue

      if (trimmed === 'data: [DONE]') {
        break
      }

      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.slice(6)
        try {
          const parsed = JSON.parse(jsonStr)
          const content = parsed.choices?.[0]?.delta?.content || ''
          if (content) {
            fullText += content
            onChunk(content)
          }
        } catch {
          // Ignore incomplete JSON chunks
        }
      }
    }
  }

  return fullText
}
