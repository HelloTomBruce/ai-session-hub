/**
 * 端点兼容性记忆（进程内单例）。
 *
 * 部分 OpenAI 兼容端点对可选参数有硬性限制：
 * - kimi-for-coding、o 系列等拒绝自定义 temperature
 * - 部分网关拒绝 response_format: json_object
 *
 * 三个历史实现（stream-client / llm-judge / distill callLLM）各自维护过
 * 一套记忆与重试矩阵，行为漂移。此处收敛为唯一事实源：
 * 流式与非流式共享同一份记忆，命中记忆的组合直接跳过，不再撞 400。
 */

const noTemperatureModels = new Set<string>()
const noJsonModeModels = new Set<string>()

export function modelKeyOf(provider: { baseUrl?: string, model?: string }): string {
  const baseUrl = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  return `${baseUrl}|${provider.model || 'gpt-4o-mini'}`
}

export function remembersNoTemperature(key: string): boolean {
  return noTemperatureModels.has(key)
}

export function remembersNoJsonMode(key: string): boolean {
  return noJsonModeModels.has(key)
}

/** 根据 400 响应体标记端点限制；返回 true 表示识别出已知限制 */
export function markEndpointLimitFrom400(key: string, errText: string): boolean {
  if (/temperature/i.test(errText)) {
    noTemperatureModels.add(key)
    console.info(`[LLM] Endpoint ${key} rejects custom temperature, omitting from now on`)
    return true
  }
  if (/response_format|json[_ ]mode|json_object/i.test(errText)) {
    noJsonModeModels.add(key)
    console.info(`[LLM] Endpoint ${key} rejects response_format, omitting from now on`)
    return true
  }
  return false
}

/** 依据记忆与选项构建应依次尝试的请求体参数组合（从最完整到最裸） */
export function buildAttemptVariants(
  key: string,
  temperature: number,
  jsonMode: boolean
): Array<{ temperature?: number, jsonMode: boolean }> {
  const wantTemp = !remembersNoTemperature(key)
  const wantJson = jsonMode && !remembersNoJsonMode(key)

  const variants: Array<{ temperature?: number, jsonMode: boolean }> = []
  if (wantTemp && wantJson) variants.push({ temperature, jsonMode: true })
  if (wantTemp) variants.push({ temperature, jsonMode: false })
  if (wantJson) variants.push({ temperature: undefined, jsonMode: true })
  variants.push({ temperature: undefined, jsonMode: false })
  return variants
}
