import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  LlmJudgeEvaluator,
  ValueScoringEngine,
  ChangeImpactEvaluator,
  ReasoningDensityEvaluator,
  ExecutionQualityEvaluator,
  normalizeEvidence,
  type IEvaluatorStrategy,
  type StrategyScoreResult,
  type EvaluationContext,
  type EvaluationEvidence
} from '@session-hub/analyzer'
import { contractSession, trivialSession, noThoughtHighValueSession } from '../fixtures/sessions'
import type { LLMProviderSettings } from '../../server/utils/llm-provider-config'

const provider: LLMProviderSettings = {
  enabled: true,
  providerType: 'openai-compatible',
  baseUrl: 'https://llm.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
  temperature: 0.1
}

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

test('LLM 网络失败 → confidence 0 缺席，不注入 50 分', async () => {
  globalThis.fetch = async () => {
    throw new Error('network down')
  }
  const judge = new LlmJudgeEvaluator(provider)
  const r = await judge.evaluate(contractSession('claude'), normalizeEvidence(contractSession('claude')))
  assert.equal(r.confidence, 0)
  assert.equal(r.strategyName, 'llm-judge')
  assert.equal(r.signals[0].code, 'LLM_JUDGE_UNAVAILABLE')
})

test('LLM HTTP 500 / 非法 JSON → 均缺席', async () => {
  globalThis.fetch = async () => new Response('boom', { status: 500 }) as Response
  const j1 = await new LlmJudgeEvaluator(provider).evaluate(contractSession('claude'), normalizeEvidence(contractSession('claude')))
  assert.equal(j1.confidence, 0)

  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }), { status: 200 })
  const j2 = await new LlmJudgeEvaluator(provider).evaluate(contractSession('claude'), normalizeEvidence(contractSession('claude')))
  assert.equal(j2.confidence, 0)
})

test('成功调用 → 分数/置信度映射，非法字段有兜底', async () => {
  globalThis.fetch = async () => jsonResponse({
    score: 91,
    resolved: true,
    highValue: true,
    reusable: true,
    category: 'ADR',
    confidence: 0.95,
    reason: '高质量契约改动',
    decisionTitle: '支付重试策略',
    decisionSummary: '抽接口配置化重试'
  })
  const ctx = { ...contractSession('claude'), sessionId: 'llm-success' }
  const judge = new LlmJudgeEvaluator(provider)
  const r = await judge.evaluate(ctx, normalizeEvidence(ctx))
  assert.equal(r.rawScore, 91)
  assert.equal(r.confidence, 0.95)
  assert.equal(r.details?.resolved, true)
  assert.equal(r.details?.decisionTitle, '支付重试策略')
  assert.ok(typeof r.details?.evidenceHash === 'string')
})

test('证据包包含改动文件、patch、thought 与末轮回复', async () => {
  let capturedBody = ''
  globalThis.fetch = async (_url: unknown, init?: RequestInit) => {
    capturedBody = String(init?.body || '')
    return jsonResponse({ score: 80, resolved: true, highValue: true, confidence: 0.9 })
  }
  const ctx = { ...contractSession('claude'), sessionId: 'llm-brief' }
  await new LlmJudgeEvaluator(provider).evaluate(ctx, normalizeEvidence(ctx))
  assert.match(capturedBody, /billing-service\.ts/)
  assert.match(capturedBody, /BillingOptions/)
  assert.match(capturedBody, /根因分析/)
  assert.match(capturedBody, /测试通过/)
})

test('同会话重跑命中缓存，不重复调用 LLM', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return jsonResponse({ score: 80, resolved: true, highValue: true, confidence: 0.9 })
  }
  const judge = new LlmJudgeEvaluator(provider)
  await judge.evaluate(contractSession('claude'), normalizeEvidence(contractSession('claude')))
  const r2 = await judge.evaluate(contractSession('claude'), normalizeEvidence(contractSession('claude')))
  assert.equal(calls, 1)
  assert.equal(r2.details?.cached, true)
})

class FakeLlmJudge implements IEvaluatorStrategy {
  readonly name = 'llm-judge'
  constructor(private result: StrategyScoreResult) {}
  isAvailable(): boolean {
    return true
  }

  async evaluate(_ctx: EvaluationContext, _ev: EvaluationEvidence): Promise<StrategyScoreResult> {
    return this.result
  }
}

function engineWithLlm(llm: StrategyScoreResult): ValueScoringEngine {
  return new ValueScoringEngine({
    strategies: [
      new ChangeImpactEvaluator(),
      new ReasoningDensityEvaluator(),
      new ExecutionQualityEvaluator(),
      new FakeLlmJudge(llm)
    ]
  })
}

function llmResult(partial: Partial<StrategyScoreResult['details']> & { confidence: number, score: number }): StrategyScoreResult {
  return {
    strategyName: 'llm-judge',
    rawScore: partial.score,
    confidence: partial.confidence,
    signals: [{ code: 'LLM_JUDGE', polarity: 'neutral', message: 'fake' }],
    details: partial
  }
}

test('LLM 缺席（confidence 0）时总分与无 LLM 引擎完全一致', async () => {
  const ctx = contractSession('claude')
  const without = await new ValueScoringEngine({
    strategies: [new ChangeImpactEvaluator(), new ReasoningDensityEvaluator(), new ExecutionQualityEvaluator()]
  }).evaluate(ctx)
  const withFailed = await engineWithLlm(llmResult({ score: 50, confidence: 0 })).evaluate(ctx)
  assert.equal(withFailed.overallScore, without.overallScore)
  assert.equal(withFailed.subScores.llmJudgeQuality, undefined)
})

test('高置信 unresolved + 本地零编辑佐证 → veto', async () => {
  const r = await engineWithLlm(
    llmResult({ score: 30, confidence: 0.9, resolved: false, highValue: false })
  ).evaluate(trivialSession())
  assert.equal(r.vetoed, true)
  assert.equal(r.isWorthSaving, false)
})

test('高置信 unresolved 但会话有编辑且闭环 → 本地证据不佐证，不 veto', async () => {
  const r = await engineWithLlm(
    llmResult({ score: 20, confidence: 0.95, resolved: false, highValue: false })
  ).evaluate(contractSession('claude'))
  assert.equal(r.vetoed, false, r.summaryReason)
  assert.notEqual(r.category, 'Trivial', r.summaryReason)
})

test('低置信 unresolved（<0.8）→ 不 veto', async () => {
  const r = await engineWithLlm(
    llmResult({ score: 55, confidence: 0.6, resolved: false, highValue: false })
  ).evaluate(trivialSession())
  assert.equal(r.vetoed, false)
})

test('无 thought 高价值会话在有 LLM 参与时不被失败裁判拖分（失败缺席）', async () => {
  const ctx = noThoughtHighValueSession()
  const r = await engineWithLlm(llmResult({ score: 50, confidence: 0 })).evaluate(ctx)
  assert.equal(r.subScores.llmJudgeQuality, undefined)
  assert.ok(r.overallScore >= 55, `score=${r.overallScore}`)
})

test('temperature 被拒（kimi-for-coding 类模型）→ 自动去 temperature 重试并进程内记住', async () => {
  const calls: Array<Record<string, unknown> | undefined> = []
  globalThis.fetch = async (_url: unknown, init?: RequestInit) => {
    calls.push(init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined)
    if (calls.length === 1) {
      return new Response(
        JSON.stringify({ error: { message: 'invalid temperature: only 1 is allowed for this model' } }),
        { status: 400 }
      )
    }
    return jsonResponse({ score: 80, resolved: true, highValue: true, reusable: true, category: 'ADR', confidence: 0.9, reason: 'ok' })
  }

  // 用独立 model 名避免与前面用例的 judgeCache 指纹撞车
  const judge = new LlmJudgeEvaluator({ ...provider, model: 'temp-reject-model' })
  const ev = normalizeEvidence(contractSession('claude'))
  const r1 = await judge.evaluate(contractSession('claude'), ev)
  assert.equal(r1.confidence, 0.9)
  assert.equal(calls.length, 2)
  assert.equal(calls[0]?.temperature, 0.1)
  assert.equal('temperature' in (calls[1] || {}), false)

  // 模型已被记住：换个会话也只发一次请求且直接不带 temperature
  const ev2 = normalizeEvidence(trivialSession('claude'))
  const r2 = await judge.evaluate(trivialSession('claude'), ev2)
  assert.equal(r2.confidence, 0.9)
  assert.equal(calls.length, 3)
  assert.equal('temperature' in (calls[2] || {}), false)
})
