import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROVIDER_TYPES,
  resolveProviderSpec,
  defaultBaseUrlFor,
  normalizeBaseUrl,
  makeChatModel
} from '@session-hub/llm'
import { deriveEnvProvider, normalizeSettings } from '../../server/utils/llm-provider-config'

/**
 * 回归背景：providerType 早就存在于配置里，但 makeChatModel 一律用
 * createOpenAICompatible 发请求 —— 选 Claude / Gemini 时按 OpenAI 报文调，
 * 必然失败。以下用例锁死「类型 → wire format」的映射。
 */

test('协议映射：厂商名 → wire format', () => {
  assert.equal(resolveProviderSpec('openai').spec, 'openai-chat')
  assert.equal(resolveProviderSpec('openai-responses').spec, 'openai-responses')
  assert.equal(resolveProviderSpec('anthropic').spec, 'anthropic-messages')
  assert.equal(resolveProviderSpec('gemini').spec, 'google-gemini')
  // 兼容层：DeepSeek / Ollama / 自建网关都走 OpenAI 兼容协议
  assert.equal(resolveProviderSpec('deepseek').spec, 'openai-compatible')
  assert.equal(resolveProviderSpec('ollama').spec, 'openai-compatible')
  assert.equal(resolveProviderSpec('openai-compatible').spec, 'openai-compatible')
})

test('协议映射：未知/空值退化到 OpenAI 兼容（老配置不炸）', () => {
  for (const v of ['', null, undefined, 'claude-3', 'foo']) {
    assert.equal(resolveProviderSpec(v as string | null | undefined).spec, 'openai-compatible')
  }
})

test('默认端点：各协议有自己的 baseUrl', () => {
  assert.equal(defaultBaseUrlFor('anthropic'), 'https://api.anthropic.com/v1')
  assert.equal(defaultBaseUrlFor('gemini'), 'https://generativelanguage.googleapis.com/v1beta')
  assert.equal(defaultBaseUrlFor('openai'), 'https://api.openai.com/v1')
})

test('normalizeBaseUrl：去尾斜杠 + 摘掉 Gemini 旧的 OpenAI 兼容后缀', () => {
  assert.equal(normalizeBaseUrl('https://api.anthropic.com/v1/', 'anthropic'), 'https://api.anthropic.com/v1')
  // 历史预设曾指向 Google 的 OpenAI 兼容层，切到原生协议必须摘掉 /openai
  assert.equal(
    normalizeBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini'),
    'https://generativelanguage.googleapis.com/v1beta'
  )
  // 留空时回落到协议默认端点
  assert.equal(normalizeBaseUrl('', 'gemini'), 'https://generativelanguage.googleapis.com/v1beta')
})

test('makeChatModel：按协议构建对应 provider 的模型', () => {
  const base = { enabled: true, baseUrl: '', apiKey: 'k', temperature: 0 }
  const cases: Array<[string, string, string]> = [
    ['anthropic', 'claude-sonnet-4-5', 'anthropic'],
    ['gemini', 'gemini-2.5-flash', 'google'],
    ['openai', 'gpt-4o-mini', 'openai'],
    ['openai-responses', 'gpt-4.1-mini', 'openai'],
    ['openai-compatible', 'deepseek-chat', 'session-hub']
  ]
  for (const [providerType, model, providerHint] of cases) {
    const built = makeChatModel({ ...base, providerType, model } as never)
    assert.equal(built.modelId, model)
    assert.ok(
      String(built.provider).includes(providerHint),
      `${providerType} 期望 provider 含 "${providerHint}"，实际 "${built.provider}"`
    )
  }
})

test('PROVIDER_TYPES 覆盖新协议且不含重复', () => {
  for (const t of ['openai', 'openai-responses', 'openai-compatible', 'anthropic', 'gemini', 'deepseek', 'ollama']) {
    assert.ok((PROVIDER_TYPES as string[]).includes(t), `缺少 ${t}`)
  }
  assert.equal(new Set(PROVIDER_TYPES).size, PROVIDER_TYPES.length)
})

test('deriveEnvProvider：按 key 选择原生协议而非一律 OpenAI 兼容', () => {
  const anthropic = deriveEnvProvider({ ANTHROPIC_API_KEY: 'sk-ant' } as NodeJS.ProcessEnv)
  assert.equal(anthropic?.providerType, 'anthropic')
  assert.equal(anthropic?.baseUrl, 'https://api.anthropic.com/v1')

  const gemini = deriveEnvProvider({ GEMINI_API_KEY: 'g-key' } as NodeJS.ProcessEnv)
  assert.equal(gemini?.providerType, 'gemini')
  assert.equal(gemini?.baseUrl, 'https://generativelanguage.googleapis.com/v1beta')

  const openai = deriveEnvProvider({ OPENAI_API_KEY: 'sk-x' } as NodeJS.ProcessEnv)
  assert.equal(openai?.providerType, 'openai-compatible')

  assert.equal(deriveEnvProvider({} as NodeJS.ProcessEnv), null)
})

test('normalizeSettings：非法协议/温度/空端点被收敛', () => {
  const s = normalizeSettings({ providerType: 'bogus', baseUrl: '', model: '', temperature: 9 } as never)
  assert.equal(s.providerType, 'openai-compatible')
  assert.equal(s.baseUrl, 'https://api.openai.com/v1')
  assert.equal(s.model, 'gpt-4o-mini')
  assert.equal(s.temperature, 2)

  const a = normalizeSettings({ providerType: 'anthropic', baseUrl: '', model: '', temperature: -1 } as never)
  assert.equal(a.baseUrl, 'https://api.anthropic.com/v1')
  assert.equal(a.model, 'claude-sonnet-4-5')
  assert.equal(a.temperature, 0)
})
