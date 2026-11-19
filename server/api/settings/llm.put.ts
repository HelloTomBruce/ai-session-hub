import { saveLLMProviderSettings, VALID_PROVIDER_TYPES, type LLMProviderSettings } from '../../utils/llm-provider-config'

/**
 * 保存模型配置。
 * 入参走统一校验层：协议类型必须在白名单内，baseUrl 必须是 http(s)，
 * temperature 夹在 [0, 2]；apiKey 留空表示「不修改」。
 */
export default defineEventHandler(async (event) => {
  const body = await readJsonBody(event)

  const providerType = optionalString(body.providerType, {
    field: 'providerType',
    max: 40,
    oneOf: VALID_PROVIDER_TYPES
  })
  const baseUrl = optionalString(body.baseUrl, { field: 'baseUrl', max: 500 })
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    throw createError({ statusCode: 400, message: 'baseUrl 必须以 http:// 或 https:// 开头' })
  }

  const patch: Partial<LLMProviderSettings> = {
    providerType: providerType as LLMProviderSettings['providerType'] | undefined,
    baseUrl,
    model: optionalString(body.model, { field: 'model', max: 200 }),
    apiKey: optionalString(body.apiKey, { field: 'apiKey', max: 500 }),
    enabled: optionalBool(body.enabled, 'enabled'),
    temperature: requireNumber(body.temperature, { field: 'temperature', min: 0, max: 2, fallback: undefined }) ?? undefined
  }

  const saved = saveLLMProviderSettings(patch)

  return {
    success: true,
    data: {
      ...saved,
      apiKeyMasked: saved.apiKey ? `${saved.apiKey.slice(0, 4)}••••••••${saved.apiKey.slice(-4)}` : '',
      hasKey: Boolean(saved.apiKey)
    }
  }
})
