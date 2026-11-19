import { completeLLM, resolveProviderSpec } from '@session-hub/llm'
import { getLLMProviderSettings, type LLMProviderSettings } from '../../../utils/llm-provider-config'

/**
 * 连通性自检：用一条极小的非 JSON 请求验证「协议 + 端点 + 密钥 + 模型名」是否匹配。
 *
 * 设计要点：
 * - 允许请求体覆盖未保存的表单值，用户可以先测再存
 * - 校验失败不返回 500：HTTP 200 + ok:false，前端按结果提示（避免 $fetch 抛错掩盖原因）
 * - 20s 超时，失败信息只回传首行，避免把整段 HTML 错误页塞进 UI
 */
export default defineEventHandler(async (event) => {
  const body = await readJsonBody(event).catch(() => ({} as Record<string, unknown>))
  const stored = getLLMProviderSettings()

  const candidate: LLMProviderSettings = {
    ...stored,
    providerType: (optionalString(body.providerType, { field: 'providerType', max: 40 }) as LLMProviderSettings['providerType']) || stored.providerType,
    baseUrl: optionalString(body.baseUrl, { field: 'baseUrl', max: 500 }) || stored.baseUrl,
    model: optionalString(body.model, { field: 'model', max: 200 }) || stored.model,
    apiKey: optionalString(body.apiKey, { field: 'apiKey', max: 500 }) || stored.apiKey,
    temperature: requireNumber(body.temperature, { field: 'temperature', min: 0, max: 2, fallback: stored.temperature })
  }

  const spec = resolveProviderSpec(candidate.providerType)
  const started = Date.now()

  try {
    const text = await completeLLM(
      { ...candidate, enabled: true },
      '你是连通性测试助手，只回复一个词。',
      '请只回复：ok',
      { jsonMode: false, temperature: 0, timeoutMs: 20_000 }
    )
    return {
      success: true,
      ok: true,
      latencyMs: Date.now() - started,
      spec: spec.spec,
      label: spec.label,
      providerType: candidate.providerType,
      model: candidate.model,
      sample: String(text || '').trim().slice(0, 120)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: true,
      ok: false,
      latencyMs: Date.now() - started,
      spec: spec.spec,
      label: spec.label,
      providerType: candidate.providerType,
      model: candidate.model,
      error: (message.split('\n')[0] || message).slice(0, 300)
    }
  }
})
