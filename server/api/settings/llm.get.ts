import { getLLMProviderSettings } from '../../utils/llm-provider-config'

export default defineEventHandler(() => {
  const settings = getLLMProviderSettings()
  // Mask API key for security in response
  const maskedKey = settings.apiKey 
    ? `${settings.apiKey.slice(0, 4)}••••••••${settings.apiKey.slice(-4)}`
    : ''

  return {
    success: true,
    data: {
      ...settings,
      apiKeyMasked: maskedKey,
      hasKey: Boolean(settings.apiKey)
    }
  }
})
