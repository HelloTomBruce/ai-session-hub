import type { LLMProviderSettings } from './llm-provider-config'

export interface StreamChunkCallback {
  (chunk: string): void
}

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

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature,
      stream: true
    })
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`LLM API responded with ${res.status}: ${errText}`)
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
