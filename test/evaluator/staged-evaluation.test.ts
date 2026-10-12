import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ValueScoringEngine,
  ChangeImpactEvaluator,
  ReasoningDensityEvaluator,
  ExecutionQualityEvaluator,
  type IEvaluatorStrategy,
  type EvaluationContext,
  type EvaluationEvidence,
  type StrategyScoreResult
} from '@session-hub/analyzer'
import { contractSession } from '../fixtures/sessions'

test('evaluateStaged 钩子按 evidence→scoring→judge(skipped)→verdict 顺序触发', async () => {
  const order: string[] = []
  const engine = new ValueScoringEngine({
    strategies: [
      new ChangeImpactEvaluator(),
      new ReasoningDensityEvaluator(),
      new ExecutionQualityEvaluator()
    ]
  })
  const { report } = await engine.evaluateStaged(contractSession('claude'), {
    onEvidence: () => order.push('evidence'),
    onScoring: () => order.push('scoring'),
    onJudge: s => order.push(`judge:${s}`),
    onVerdict: () => order.push('verdict')
  })
  assert.deepEqual(order, ['evidence', 'scoring', 'judge:skipped', 'verdict'])
  assert.equal(report.evaluatorVersion, 2)
})

class FakeJudge implements IEvaluatorStrategy {
  readonly name = 'llm-judge'
  isAvailable(): boolean {
    return true
  }

  async evaluate(_ctx: EvaluationContext, _ev: EvaluationEvidence): Promise<StrategyScoreResult> {
    return {
      strategyName: 'llm-judge',
      rawScore: 88,
      confidence: 0.9,
      signals: [{ code: 'LLM_JUDGE', polarity: 'positive', message: 'ok' }],
      details: { resolved: true, highValue: true, evidenceHash: 'hash123' }
    }
  }
}

test('evaluateStaged 有裁判时状态为 running 且 evidenceHash 透出', async () => {
  const states: string[] = []
  const engine = new ValueScoringEngine({
    strategies: [
      new ChangeImpactEvaluator(),
      new ReasoningDensityEvaluator(),
      new ExecutionQualityEvaluator(),
      new FakeJudge()
    ]
  })
  const { report, evidenceHash } = await engine.evaluateStaged(contractSession('codex'), {
    onJudge: s => states.push(s)
  })
  assert.deepEqual(states, ['running'])
  assert.equal(evidenceHash, 'hash123')
  assert.equal(report.subScores.llmJudgeQuality, 88)
})
