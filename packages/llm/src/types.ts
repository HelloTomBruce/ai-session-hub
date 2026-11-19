/**
 * LLM 提供方契约与调用选项。
 * 宿主（server/utils/llm-provider-config）负责从 ~/.session-hub 读写配置；
 * 本包只消费契约发起调用，无文件系统副作用。
 */

/**
 * 协议类型（决定用哪套 wire format，而不是“哪家厂商”）：
 * - openai-chat        OpenAI Chat Completions（/v1/chat/completions）
 * - openai-responses   OpenAI Responses API（新一代，/v1/responses）
 * - openai-compatible  任何 OpenAI 兼容网关：DeepSeek / Kimi / 智谱 / Ollama / vLLM / one-api
 * - anthropic-messages Anthropic Messages（/v1/messages，Claude 系）
 * - google-gemini      Google Generative AI（:generateContent，Gemini 系）
 */
export type LLMProviderType
  = | 'openai'
    | 'openai-responses'
    | 'openai-compatible'
    | 'anthropic'
    | 'gemini'
    | 'deepseek'
    | 'ollama'

export interface LLMProviderSettings {
  enabled: boolean
  providerType: LLMProviderType
  /** 协议端点前缀；留空时按 providerType 取默认值 */
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
}

/** 非流式补全选项 */
export interface CompleteLLMOptions {
  /** 采样温度，默认 0.2 */
  temperature?: number
  /** 请求超时（毫秒），默认 120_000；超时抛出 AbortError 派生错误 */
  timeoutMs?: number
  /** 是否请求 JSON 输出模式（端点不支持时自动降级） */
  jsonMode?: boolean
}
