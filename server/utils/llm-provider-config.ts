import { logger } from './logger'
import fs from 'node:fs'
import path from 'node:path'
import { hubHome } from './db'
import {
  PROVIDER_TYPES,
  resolveProviderSpec,
  defaultBaseUrlFor,
  type LLMProviderSettings,
  type LLMProviderType
} from '@session-hub/llm'

// 类型契约归属 @session-hub/analyzer / @session-hub/llm；此处 re-export 保持既有 import 兼容
export type { LLMProviderSettings, LLMProviderType }

const CONFIG_FILE = 'llm-provider.json'

const DEFAULT_SETTINGS: LLMProviderSettings = {
  enabled: false,
  providerType: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.1
}

/** 合法协议类型（设置接口与前端下拉共用同一份事实源） */
export const VALID_PROVIDER_TYPES = PROVIDER_TYPES

/**
 * 配置归一化：把历史/手写的非法值收敛到契约内。
 * - providerType 不在白名单 → 退回 openai-compatible（老配置仍可用）
 * - baseUrl 为空 → 按协议取默认端点；gemini 旧的 `/v1beta/openai` 后缀会被摘掉
 * - temperature 夹到 [0, 2]
 */
export function normalizeSettings(raw: Partial<LLMProviderSettings> | null | undefined): LLMProviderSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) } as LLMProviderSettings
  const providerType = (VALID_PROVIDER_TYPES as string[]).includes(merged.providerType)
    ? merged.providerType
    : DEFAULT_SETTINGS.providerType

  const spec = resolveProviderSpec(providerType)
  let baseUrl = String(merged.baseUrl || '').trim().replace(/\/+$/, '')
  if (!baseUrl) baseUrl = defaultBaseUrlFor(providerType)
  if (spec.spec === 'google-gemini') baseUrl = baseUrl.replace(/\/openai$/i, '')

  const temperature = Number(merged.temperature)
  return {
    enabled: Boolean(merged.enabled),
    providerType: providerType as LLMProviderType,
    baseUrl,
    apiKey: String(merged.apiKey || ''),
    model: String(merged.model || '').trim() || spec.defaultModel,
    temperature: Number.isFinite(temperature) ? Math.min(2, Math.max(0, temperature)) : DEFAULT_SETTINGS.temperature
  }
}

/**
 * 从环境变量推导 provider（没有配置文件时的兜底）。
 * 顺序即优先级：显式给 Anthropic / Gemini 的 key 时，按对应原生协议配置，
 * 而不是像以前那样统统套 OpenAI 兼容端点（那样必然 401）。
 */
export function deriveEnvProvider(env: NodeJS.ProcessEnv = process.env): Partial<LLMProviderSettings> | null {
  if (env.ANTHROPIC_API_KEY) {
    return {
      enabled: true,
      providerType: 'anthropic',
      baseUrl: env.ANTHROPIC_BASE_URL || defaultBaseUrlFor('anthropic'),
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL || resolveProviderSpec('anthropic').defaultModel
    }
  }
  const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY
  if (geminiKey) {
    return {
      enabled: true,
      providerType: 'gemini',
      baseUrl: env.GEMINI_BASE_URL || defaultBaseUrlFor('gemini'),
      apiKey: geminiKey,
      model: env.GEMINI_MODEL || resolveProviderSpec('gemini').defaultModel
    }
  }
  if (env.OPENAI_API_KEY) {
    return {
      enabled: true,
      // 历史行为保持：OPENAI_BASE_URL 可能指向自建网关，按兼容协议处理
      providerType: 'openai-compatible',
      baseUrl: env.OPENAI_BASE_URL || DEFAULT_SETTINGS.baseUrl,
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || DEFAULT_SETTINGS.model
    }
  }
  return null
}

export function getLLMProviderSettings(): LLMProviderSettings {
  const configPath = path.join(hubHome(), CONFIG_FILE)
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8')
      return normalizeSettings(JSON.parse(data) as Partial<LLMProviderSettings>)
    }
  } catch (err) {
    logger.error('[LLM Provider] Failed to read settings:', err)
  }

  const envProvider = deriveEnvProvider()
  if (envProvider) return normalizeSettings(envProvider)
  return { ...DEFAULT_SETTINGS }
}

export function saveLLMProviderSettings(settings: Partial<LLMProviderSettings>): LLMProviderSettings {
  const current = getLLMProviderSettings()
  // 空字符串的 apiKey 视为「不修改」，避免前端留空保存把已有 key 抹掉
  const patch: Partial<LLMProviderSettings> = { ...settings }
  if (patch.apiKey !== undefined && String(patch.apiKey).trim() === '') delete patch.apiKey

  const updated = normalizeSettings({ ...current, ...patch })

  try {
    const dir = hubHome()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, CONFIG_FILE), JSON.stringify(updated, null, 2), 'utf-8')
  } catch (err) {
    logger.error('[LLM Provider] Failed to save settings:', err)
  }

  return updated
}
