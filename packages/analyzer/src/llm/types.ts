/**
 * LLM 提供方契约（@session-hub/analyzer 的唯一外部协议形状）。
 * 宿主（server/utils/llm-provider-config）负责从 ~/.session-hub 读写配置，
 * 并 re-export 本类型保持既有 import 兼容。
 */
export interface LLMProviderSettings {
  enabled: boolean
  providerType: 'openai-compatible' | 'gemini' | 'anthropic' | 'ollama' | 'deepseek'
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
}
