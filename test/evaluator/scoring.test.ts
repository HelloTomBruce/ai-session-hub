import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSessionValue } from '@session-hub/analyzer'
import { contractSession, trivialSession, thrashingSession, noThoughtHighValueSession, gotchaSession, milestoneSession } from '../fixtures/sessions'

test('契约改动会话 → ADR 且达到沉淀线', async () => {
  const r = await evaluateSessionValue(contractSession('claude'))
  assert.equal(r.category, 'ADR', r.summaryReason)
  assert.equal(r.isWorthSaving, true)
  assert.ok(r.overallScore >= 72, `score=${r.overallScore}`)
  assert.ok(r.subScores.changeImpact >= 70, `change=${r.subScores.changeImpact}`)
  assert.equal(r.evaluatorVersion, 2)
  assert.ok(r.signalDetails.length > 0)
})

test('平凡问答 → Trivial 且不沉淀', async () => {
  const r = await evaluateSessionValue(trivialSession())
  assert.equal(r.isWorthSaving, false)
  assert.ok(r.overallScore < 55, `score=${r.overallScore}`)
})

test('thrashing + 盲搜 + 未闭环 → veto，Trivial 不沉淀', async () => {
  const r = await evaluateSessionValue(thrashingSession())
  assert.equal(r.vetoed, true)
  assert.equal(r.flags.thrashing, true)
  assert.equal(r.flags.searchLoop, true)
  assert.equal(r.flags.unresolved, true)
  assert.equal(r.category, 'Trivial')
  assert.equal(r.isWorthSaving, false)
})

test('无 thinking 的高价值会话不被系统性压到低分', async () => {
  const r = await evaluateSessionValue(noThoughtHighValueSession())
  assert.ok(r.subScores.reasoningDensity >= 45, `reasoning=${r.subScores.reasoningDensity}`)
  assert.ok(r.overallScore >= 60, `score=${r.overallScore}`)
})

test('同样工作量跨平台总分极差 ≤ 10', async () => {
  const scores: number[] = []
  for (const p of ['claude', 'codex', 'pi'] as const) {
    const r = await evaluateSessionValue(contractSession(p))
    scores.push(r.overallScore)
  }
  const spread = Math.max(...scores) - Math.min(...scores)
  assert.ok(spread <= 10, `scores=${scores.join(',')} spread=${spread}`)
})

test('根因排障会话 → Gotcha（证据门通过）', async () => {
  const r = await evaluateSessionValue(gotchaSession())
  assert.equal(r.category, 'Gotcha', `${r.category} ${r.overallScore} ${r.summaryReason}`)
  assert.equal(r.isWorthSaving, true)
})

test('多文件落地但无契约/根因特征 → Milestone 可达', async () => {
  const r = await evaluateSessionValue(milestoneSession())
  assert.equal(r.category, 'Milestone', `${r.category} score=${r.overallScore} ${r.summaryReason}`)
})
