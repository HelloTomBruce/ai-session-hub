import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  indexDiagnosis,
  listDiagnoses,
  getDiagnosisSummary,
  deleteDiagnosis
} from '../../server/utils/diagnosis-index'
import { recallStats } from '../../server/utils/recall-stats'
import type { AIEvaluationResult } from '@session-hub/analyzer'

function makeReport(overrides: Partial<AIEvaluationResult> = {}): AIEvaluationResult {
  return {
    score: 72,
    grade: 'B',
    gradeLabel: '偶有波折',
    taskSummary: '重构订单模块',
    taskCompletionStatus: 'Full',
    subScores: {
      directness: 88,
      decisionSoundness: 64,
      turnVelocity: 76,
      actionDensity: 100
    },
    deductions: [
      { category: 'backtrack', turn: 3, title: '方案推翻', deductionPoints: 6, reason: 'r', evidenceSnippet: 'e' },
      { category: 'search_heavy', turn: 4, title: '密集搜索', deductionPoints: 8, reason: 'r', evidenceSnippet: 'e' }
    ],
    strengths: [],
    bottlenecks: [],
    prescriptions: [],
    evaluatedAt: Date.now(),
    ...overrides
  }
}

test('诊断索引：写入 / 幂等更新 / 读取 / 汇总 / 清理', () => {
  const sessionId = `test_diag_${Date.now()}`
  const platform = 'agy'
  const cwd = '/tmp/session-hub-test-project'

  assert.equal(indexDiagnosis({ sessionId, platform, cwd, report: makeReport(), source: 'backfill' }), true)

  // 幂等更新：同键不重复，值被刷新（改为 S）
  assert.equal(
    indexDiagnosis({ sessionId, platform, cwd, report: makeReport({ score: 93, grade: 'S' }), source: 'report' }),
    true
  )

  const rows = listDiagnoses({ cwd, limit: 50 })
  const row = rows.find(r => r.session_id === sessionId)
  assert.ok(row)
  assert.equal(row.score, 93)
  assert.equal(row.grade, 'S')
  assert.equal(row.decision_soundness, 64)
  assert.equal(row.directness, 88)
  assert.equal(row.source, 'report')
  assert.match(row.friction_events_json, /backtrack/)

  const summary = getDiagnosisSummary()
  assert.ok(summary.total >= 1)
  assert.ok(summary.frictionSessions >= 1) // 上面写入了 2 条摩擦事件

  // 清理
  assert.equal(deleteDiagnosis(sessionId, platform), true)
  assert.equal(listDiagnoses({ cwd, limit: 50 }).find(r => r.session_id === sessionId), undefined)
})

test('召回事件：写入带 cwd 上下文的曝光埋点并可读取', () => {
  const source = `test-src-${Date.now()}`
  recallStats.logRecallEvent({
    cwd: '/tmp/session-hub-test-project',
    type: 'Gotcha',
    query: '盲搜',
    memoryIds: ['mem_x', 'mem_y'],
    source
  })

  const events = recallStats.listEventsSince(0, 5000).filter(e => e.source === source)
  assert.equal(events.length, 1)
  assert.equal(events[0].cwd, '/tmp/session-hub-test-project')
  assert.equal(events[0].type, 'Gotcha')
  assert.equal(events[0].count, 2)
  assert.match(events[0].memory_ids_json, /mem_x/)

  // 清理
  assert.equal(recallStats.deleteEventsBySource(source), 1)
  assert.equal(recallStats.listEventsSince(0, 5000).filter(e => e.source === source).length, 0)
})
