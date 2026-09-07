import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface LLMProviderSettings {
  enabled: boolean
  providerType: 'openai-compatible' | 'gemini' | 'anthropic' | 'ollama' | 'deepseek'
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
}

const CONFIG_DIR = path.join(os.homedir(), '.session-hub')
const CONFIG_FILE = path.join(CONFIG_DIR, 'llm-provider.json')

const DEFAULT_SETTINGS: LLMProviderSettings = {
  enabled: false,
  providerType: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.1
}

export function getLLMProviderSettings(): LLMProviderSettings {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
    }
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8')
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) }
    }
  } catch (err) {
    console.error('[LLM Provider] Failed to read settings:', err)
  }

  // Fallback to process.env if available
  const envKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY || ''
  return {
    ...DEFAULT_SETTINGS,
    enabled: Boolean(envKey),
    baseUrl: process.env.OPENAI_BASE_URL || DEFAULT_SETTINGS.baseUrl,
    apiKey: envKey,
    model: process.env.OPENAI_MODEL || DEFAULT_SETTINGS.model
  }
}

export function saveLLMProviderSettings(settings: Partial<LLMProviderSettings>): LLMProviderSettings {
  const current = getLLMProviderSettings()
  const updated = { ...current, ...settings }

  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true })
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8')
  } catch (err) {
    console.error('[LLM Provider] Failed to save settings:', err)
  }

  return updated
}
