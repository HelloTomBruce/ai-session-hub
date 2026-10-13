/**
 * 从 LLM 输出文本中提取 JSON 对象（统一围栏剥离 + 容错提取）。
 * 收敛自 distill engine / llm-judge / diagnose API 的四份变体实现。
 */
export function extractJsonFromLLMText(text: string): Record<string, unknown> {
  let cleaned = text.trim()
  // 剥离 ```json ... ``` 代码围栏
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  }
  try {
    const parsed: unknown = JSON.parse(cleaned)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 落入下方容错提取
  }
  // 容错：提取文本中首个平衡的 {...} 块
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed: unknown = JSON.parse(jsonMatch[0])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // fallthrough
    }
  }
  throw new Error(`Failed to parse JSON from LLM output: ${text.slice(0, 120)}...`)
}
