import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV4 } from '@ai-sdk/provider'
import type { LLMProviderSettings } from './types.js'

/**
 * 从 LLMProviderSettings 构建 AI SDK LanguageModel。
 * apiKey 选项自动生成 `Authorization: Bearer <key>` 头。
 */
export function makeChatModel(provider: LLMProviderSettings): LanguageModelV4 {
  const baseURL = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  return createOpenAICompatible({
    name: 'session-hub',
    baseURL,
    apiKey: provider.apiKey,
    // 目标端点（bigmodel/deepseek 等兼容网关）大多不支持 response_format 的
    // json_schema 结构化输出；显式关闭，generateObject 自动改走 tool-calling，
    // 避免每次请求先撞不支持能力再降级
    supportsStructuredOutputs: false
  }).chatModel(provider.model || 'gpt-4o-mini')
}
