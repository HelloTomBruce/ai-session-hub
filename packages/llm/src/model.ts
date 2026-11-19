import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import type { LanguageModelV4 } from '@ai-sdk/provider'
import type { LLMProviderSettings, LLMProviderType } from './types.js'

/**
 * 协议适配层：把「厂商名」翻译成「wire format」。
 *
 * 历史问题：providerType 早就写在配置里（openai-compatible / gemini / anthropic /
 * ollama / deepseek），但 makeChatModel 一律用 createOpenAICompatible 发请求，
 * 于是选 Claude 或 Gemini 时实际仍在按 OpenAI 的报文格式调用，必然失败。
 *
 * 现在按类型分发到对应的官方 provider：
 * - anthropic → @ai-sdk/anthropic 的 Messages API（x-api-key + anthropic-version）
 * - gemini    → @ai-sdk/google 的 :generateContent（含 SSE 流式）
 * - openai    → 官方 Chat Completions；openai-responses → Responses API
 * - 其余      → @ai-sdk/openai-compatible（DeepSeek / Kimi / 智谱 / Ollama / 自建网关）
 */
export type ProviderSpec
  = | 'openai-chat'
    | 'openai-responses'
    | 'openai-compatible'
    | 'anthropic-messages'
    | 'google-gemini'

export interface ResolvedProviderSpec {
  spec: ProviderSpec
  /** 面向用户的规范名称（设置页展示） */
  label: string
  defaultBaseUrl: string
  defaultModel: string
  /** 该规范下常见的模型名示例 */
  modelExamples: string[]
}

const SPECS: Record<LLMProviderType, ResolvedProviderSpec> = {
  'openai': {
    spec: 'openai-chat',
    label: 'OpenAI Chat Completions',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    modelExamples: ['gpt-4o-mini', 'gpt-4.1', 'o4-mini']
  },
  'openai-responses': {
    spec: 'openai-responses',
    label: 'OpenAI Responses API',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    modelExamples: ['gpt-4.1-mini', 'gpt-4.1', 'o4-mini']
  },
  'openai-compatible': {
    spec: 'openai-compatible',
    label: 'OpenAI 兼容端点（DeepSeek / Kimi / 智谱 / Ollama / 自建网关）',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    modelExamples: ['deepseek-chat', 'kimi-k2', 'glm-5', 'qwen2.5-coder:7b']
  },
  'deepseek': {
    spec: 'openai-compatible',
    label: 'DeepSeek（OpenAI 兼容）',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    modelExamples: ['deepseek-chat', 'deepseek-reasoner']
  },
  'ollama': {
    spec: 'openai-compatible',
    label: 'Ollama（OpenAI 兼容）',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder:7b',
    modelExamples: ['qwen2.5-coder:7b', 'llama3.3', 'deepseek-r1:8b']
  },
  'anthropic': {
    spec: 'anthropic-messages',
    label: 'Anthropic Messages（Claude）',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-5',
    modelExamples: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-5-haiku-latest']
  },
  'gemini': {
    spec: 'google-gemini',
    label: 'Google Gemini（generateContent）',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    modelExamples: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash']
  }
}

/** providerType 的合法取值（设置接口与 UI 共用） */
export const PROVIDER_TYPES = Object.keys(SPECS) as LLMProviderType[]

/**
 * 解析协议。未知值（历史配置里可能有手写的字符串）一律退化到 OpenAI 兼容，
 * 保证老配置仍能工作。
 */
export function resolveProviderSpec(providerType?: string | null): ResolvedProviderSpec {
  const key = String(providerType || '').trim().toLowerCase() as LLMProviderType
  if (key && key in SPECS) return SPECS[key]
  return SPECS['openai-compatible']
}

/** 按协议给默认 baseUrl（配置里留空时使用） */
export function defaultBaseUrlFor(providerType?: string | null): string {
  return resolveProviderSpec(providerType).defaultBaseUrl
}

/**
 * 规范化 baseUrl：
 * - 去尾部斜杠
 * - 兼容历史配置：gemini 早期预设指向 Google 的 OpenAI 兼容层 `/v1beta/openai`，
 *   切到原生 Gemini 协议后要把这个后缀摘掉，否则路径会变成
 *   `/v1beta/openai/models/...:generateContent`
 */
export function normalizeBaseUrl(baseUrl: string | undefined | null, providerType?: string | null): string {
  const spec = resolveProviderSpec(providerType)
  let url = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!url) return spec.defaultBaseUrl
  if (spec.spec === 'google-gemini') {
    url = url.replace(/\/openai$/i, '')
  }
  return url
}

/** 从 LLMProviderSettings 构建 AI SDK LanguageModel（按协议分发） */
export function makeChatModel(provider: LLMProviderSettings): LanguageModelV4 {
  const resolved = resolveProviderSpec(provider.providerType)
  const modelId = String(provider.model || '').trim() || resolved.defaultModel
  const baseURL = normalizeBaseUrl(provider.baseUrl, provider.providerType)
  const apiKey = provider.apiKey || undefined

  switch (resolved.spec) {
    case 'anthropic-messages':
      return createAnthropic({ apiKey, baseURL }).messages(modelId)

    case 'google-gemini':
      return createGoogle({ apiKey, baseURL }).chat(modelId)

    case 'openai-chat':
      return createOpenAI({ apiKey, baseURL }).chat(modelId)

    case 'openai-responses':
      return createOpenAI({ apiKey, baseURL }).responses(modelId)

    case 'openai-compatible':
    default:
      return createOpenAICompatible({
        name: 'session-hub',
        baseURL,
        apiKey: provider.apiKey,
        // 目标端点（bigmodel/deepseek 等兼容网关）大多不支持 response_format 的
        // json_schema 结构化输出；显式关闭，generateObject 自动改走 tool-calling，
        // 避免每次请求先撞不支持能力再降级
        supportsStructuredOutputs: false
      }).chatModel(modelId)
  }
}
