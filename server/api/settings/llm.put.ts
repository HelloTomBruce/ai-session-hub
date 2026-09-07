import { saveLLMProviderSettings, type LLMProviderSettings } from '../../utils/llm-provider-config'

export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<LLMProviderSettings>>(event) || {}
  const saved = saveLLMProviderSettings(body)

  return {
    success: true,
    data: {
      ...saved,
      apiKeyMasked: saved.apiKey ? `${saved.apiKey.slice(0, 4)}••••••••${saved.apiKey.slice(-4)}` : '',
      hasKey: Boolean(saved.apiKey)
    }
  }
})
