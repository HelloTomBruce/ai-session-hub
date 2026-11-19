import { getLLMProviderSettings, VALID_PROVIDER_TYPES } from '../../utils/llm-provider-config'
import { resolveProviderSpec } from '@session-hub/llm'

/**
 * 读取模型配置。
 * 同时下发协议清单（label / 默认端点 / 示例模型），供设置页渲染下拉与预设，
 * 避免前端把协议表复制一份（也避免把 LLM SDK 打进浏览器包）。
 */
export default defineEventHandler(() => {
  const settings = getLLMProviderSettings()
  const maskedKey = settings.apiKey
    ? `${settings.apiKey.slice(0, 4)}••••••••${settings.apiKey.slice(-4)}`
    : ''

  return {
    success: true,
    data: {
      ...settings,
      apiKeyMasked: maskedKey,
      hasKey: Boolean(settings.apiKey)
    },
    providers: VALID_PROVIDER_TYPES.map((type) => {
      const spec = resolveProviderSpec(type)
      return {
        value: type,
        label: spec.label,
        spec: spec.spec,
        defaultBaseUrl: spec.defaultBaseUrl,
        defaultModel: spec.defaultModel,
        modelExamples: spec.modelExamples
      }
    })
  }
})
