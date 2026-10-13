import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { completeLLM, extractJsonFromLLMText, buildAttemptVariants, markEndpointLimitFrom400 } from '@session-hub/llm'
import type { LLMProviderSettings } from '@session-hub/llm'

function makeProvider(suffix: string): LLMProviderSettings {
  return {
    enabled: true,
    providerType: 'openai-compatible',
    baseUrl: `http://llm-${suffix}.test/v1`,
    apiKey: 'test-key',
    model: 'test-model',
    temperature: 0.2
  }
}

function jsonResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

test('completeLLM：正常路径一次成功，请求携带 temperature（jsonMode=false 走纯文本通道）', async () => {
  const provider = makeProvider('ok')
  const bodies: Array<Record<string, unknown>> = []
  const fetchMock = mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return jsonResponse('{"score": 88}')
  })
  try {
    const out = await completeLLM(provider, 'sys', 'user', { temperature: 0.3, jsonMode: false })
    assert.equal(out, '{"score": 88}')
    assert.equal(bodies.length, 1)
    assert.equal(bodies[0]?.temperature, 0.3)
    assert.equal(bodies[0]?.response_format, undefined)
  } finally {
    fetchMock.mock.restore()
  }
})

test('completeLLM：400 拒绝 temperature 时降级重试并写入共享记忆，二次调用直接跳过', async () => {
  const provider = makeProvider('temp-reject')
  let calls = 0
  const fetchMock = mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    calls++
    const body = JSON.parse(String(init?.body)) as { temperature?: number }
    if (body.temperature !== undefined) {
      return new Response('{"error": {"message": "temperature is not supported"}}', { status: 400 })
    }
    return jsonResponse('ok')
  })
  try {
    const out1 = await completeLLM(provider, 'sys', 'user', { jsonMode: false })
    assert.equal(out1, 'ok')
    assert.equal(calls, 2)

    calls = 0
    const out2 = await completeLLM(provider, 'sys', 'user', { jsonMode: false })
    assert.equal(out2, 'ok')
    // 记忆生效：不再先撞 400
    assert.equal(calls, 1)
  } finally {
    fetchMock.mock.restore()
  }
})

test('completeLLM：非 400 HTTP 错误直接抛出，不做参数降级重试', async () => {
  const provider = makeProvider('server-error')
  let calls = 0
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    calls++
    return new Response('{"error": "quota exceeded"}', { status: 429 })
  })
  try {
    await assert.rejects(
      () => completeLLM(provider, 'sys', 'user', { jsonMode: false })
    )
    assert.equal(calls, 1)
  } finally {
    fetchMock.mock.restore()
  }
})

test('completeLLM：端点 400 拒绝 jsonMode 时降级到纯文本通道', async () => {
  const provider = makeProvider('json-reject')
  let calls = 0
  const fetchMock = mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    calls++
    const body = JSON.parse(String(init?.body)) as { tools?: unknown, response_format?: unknown }
    // generateObject 的结构化请求（response_format / tools）被端点拒绝
    if (body.tools !== undefined || body.response_format !== undefined) {
      return new Response('{"error": {"message": "response_format is not supported"}}', { status: 400 })
    }
    return jsonResponse('{"a":1}')
  })
  try {
    const out = await completeLLM(provider, 'sys', 'user', { jsonMode: true })
    assert.equal(out, '{"a":1}')
    assert.ok(calls >= 2)
  } finally {
    fetchMock.mock.restore()
  }
})

test('extractJsonFromLLMText：裸 JSON / 围栏包裹 / 前后杂质容错', () => {
  assert.deepEqual(extractJsonFromLLMText('{"a":1}'), { a: 1 })
  assert.deepEqual(extractJsonFromLLMText('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(extractJsonFromLLMText('模型输出如下：{"a":1} 以上'), { a: 1 })
  assert.throws(() => extractJsonFromLLMText('完全不是 JSON'))
})

test('buildAttemptVariants：矩阵从最完整到最裸，记忆后收缩', () => {
  const key = 'http://matrix.test/v1|m'
  assert.equal(buildAttemptVariants('http://fresh.test/v1|m', 0.2, true).length, 4)
  assert.equal(markEndpointLimitFrom400(key, 'temperature not allowed'), true)
  const variants = buildAttemptVariants(key, 0.2, true)
  assert.equal(variants.length, 2)
  assert.ok(variants.every(v => v.temperature === undefined))
})
