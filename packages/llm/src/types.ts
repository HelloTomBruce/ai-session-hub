/**
 * LLM 提供方契约与调用选项。
 * 宿主（server/utils/llm-provider-config）负责从 ~/.session-hub 读写配置；
 * 本包只消费契约发起调用，无文件系统副作用。
 */
export interface LLMProviderSettings {
  enabled: boolean
  providerType: 'openai-compatible' | 'gemini' | 'anthropic' | 'ollama' | 'deepseek'
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
  /** 是否请求 JSON 输出模式（response_format: json_object，端点不支持时自动降级） */
  jsonMode?: boolean
}
