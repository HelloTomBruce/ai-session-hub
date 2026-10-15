/**
 * 诊断索引（召回效果度量的「结果侧」数据集）。
 *
 * 背景：诊断报告此前只落 `~/.session-hub/diagnoses/{sessionId}.json` 文件，
 * 无法与召回事件（cwd / 时间）做 JOIN，导致「召回 → 摩擦是否下降」无法计算。
 * 本模块把诊断结果（含确定性 rubric）索引进 SQLite `session_diagnoses`，
 * 与 `recall_events` 共享 cwd / 时间维度，构成度量的最小地基。
 *
 * 说明：不覆盖诊断报告文件——文件仍是「是否 AI 诊断过」的唯一事实源；
 * 本表是可分析的结果数据集，backfill 仅在缺失时补写，不覆盖已有的真实诊断。
 */
import { cacheService } from './cache-service'
import { fileReportStore } from './diagnosis-service'
import { runDeterministicRubricEvaluation, type AIEvaluationResult } from '@session-hub/analyzer'

export interface DiagnosisIndexInput {
  sessionId: string
  platform: string
  cwd?: string
  report: AIEvaluationResult
  /** 结果来源：user_configured_llm | rubric_engine | report | backfill */
  source: string
}

export interface DiagnosisRow {
  session_id: string
  platform: string
  cwd: string
  score: number | null
  grade: string
  decision_soundness: number | null
  directness: number | null
  turn_velocity: number | null
  action_density: number | null
  friction_events_json: string
  source: string
  diagnosed_at: number
}

function toIntOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
}

/** 幂等写入/更新单条诊断索引（同会话同平台唯一） */
export function indexDiagnosis(input: DiagnosisIndexInput): boolean {
  const db = cacheService.getDb()
  if (!db) return false

  const r = input.report
  const sub = r.subScores || ({} as AIEvaluationResult['subScores'])

  try {
    db.prepare(`
      INSERT INTO session_diagnoses
        (session_id, platform, cwd, score, grade,
         decision_soundness, directness, turn_velocity, action_density,
         friction_events_json, source, diagnosed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, platform) DO UPDATE SET
        cwd = excluded.cwd,
        score = excluded.score,
        grade = excluded.grade,
        decision_soundness = excluded.decision_soundness,
        directness = excluded.directness,
        turn_velocity = excluded.turn_velocity,
        action_density = excluded.action_density,
        friction_events_json = excluded.friction_events_json,
        source = excluded.source,
        diagnosed_at = excluded.diagnosed_at
    `).run(
      input.sessionId,
      input.platform,
      input.cwd || '',
      toIntOrNull(r.score),
      r.grade || '',
      toIntOrNull(sub?.decisionSoundness),
      toIntOrNull(sub?.directness),
      toIntOrNull(sub?.turnVelocity),
      toIntOrNull(sub?.actionDensity),
      JSON.stringify(Array.isArray(r.deductions) ? r.deductions : []),
      input.source,
      typeof r.evaluatedAt === 'number' ? r.evaluatedAt : Date.now()
    )
    return true
  } catch (err) {
    console.error('[DiagnosisIndex] indexDiagnosis failed:', err)
    return false
  }
}

/** 已索引的会话键集合 */
function getIndexedKeys(): Set<string> {
  const db = cacheService.getDb()
  if (!db) return new Set()
  try {
    const rows = db.prepare('SELECT session_id, platform FROM session_diagnoses').all() as Array<{ session_id: string, platform: string }>
    return new Set(rows.map(r => `${r.platform}::${r.session_id}`))
  } catch {
    return new Set()
  }
}

export interface BackfillResult {
  total: number
  indexed: number
  skipped: number
  errors: number
  remaining: number
}

/**
 * 存量回填：为尚未索引的会话补写诊断结果，建立 outcome 基线。
 * - 若存在诊断报告文件 → 直接索引该报告（source=report）。
 * - 否则运行确定性 rubric（零 LLM 成本）→ 索引（source=backfill）。
 * 分批进行：单次最多处理 limit 个，返回 remaining 供再次调用。
 */
export function backfillDiagnoses(limit = 200): BackfillResult {
  const result: BackfillResult = { total: 0, indexed: 0, skipped: 0, errors: 0, remaining: 0 }

  if (!cacheService.isAvailable()) return result

  const sessions = cacheService.getCachedSessions(undefined, undefined, { limit: 5000 })
  result.total = sessions.length
  const indexedKeys = getIndexedKeys()

  let processed = 0
  for (const session of sessions) {
    const key = `${session.cli}::${session.id}`
    if (indexedKeys.has(key)) {
      result.skipped++
      continue
    }
    if (processed >= limit) {
      result.remaining++
      continue
    }
    processed++

    try {
      const cached = cacheService.getCachedSessionDetail(session.cli, session.id)
      if (!cached.session) {
        result.errors++
        continue
      }
      const saved = fileReportStore.load(session.id)
      const report = saved || runDeterministicRubricEvaluation(cached.session, cached.messages)
      const ok = indexDiagnosis({
        sessionId: session.id,
        platform: session.cli,
        cwd: cached.session.cwd,
        report,
        source: saved ? 'report' : 'backfill'
      })
      if (ok) result.indexed++
      else result.errors++
    } catch (err) {
      console.error('[DiagnosisIndex] backfill session failed:', session.id, err)
      result.errors++
    }
  }

  return result
}

/** 读取诊断索引行（效果度量/看板用） */
export function listDiagnoses(options: { cwd?: string, limit?: number, offset?: number } = {}): DiagnosisRow[] {
  const db = cacheService.getDb()
  if (!db) return []
  try {
    const conditions: string[] = []
    const params: unknown[] = []
    if (options.cwd) {
      conditions.push('cwd = ?')
      params.push(options.cwd)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = Math.max(1, Math.min(options.limit || 100, 2000))
    const offset = Math.max(0, options.offset || 0)
    return db.prepare(
      `SELECT * FROM session_diagnoses ${where} ORDER BY diagnosed_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as DiagnosisRow[]
  } catch (err) {
    console.error('[DiagnosisIndex] listDiagnoses failed:', err)
    return []
  }
}

/** 删除某会话的诊断索引（重新诊断 / 测试清理） */
export function deleteDiagnosis(sessionId: string, platform: string): boolean {
  const db = cacheService.getDb()
  if (!db) return false
  try {
    return db.prepare(
      'DELETE FROM session_diagnoses WHERE session_id = ? AND platform = ?'
    ).run(sessionId, platform).changes > 0
  } catch (err) {
    console.error('[DiagnosisIndex] deleteDiagnosis failed:', err)
    return false
  }
}

export interface DiagnosisSummary {
  total: number
  bySource: Record<string, number>
  byGrade: Record<string, number>
  avgScore: number | null
  avgDecisionSoundness: number | null
  frictionSessions: number
}

/** 诊断索引汇总（含主结果指标：有摩擦事件的会话数 / 占比） */
export function getDiagnosisSummary(): DiagnosisSummary {
  const db = cacheService.getDb()
  const empty: DiagnosisSummary = { total: 0, bySource: {}, byGrade: {}, avgScore: null, avgDecisionSoundness: null, frictionSessions: 0 }
  if (!db) return empty
  try {
    const total = (db.prepare('SELECT COUNT(*) as c FROM session_diagnoses').get() as { c: number }).c
    if (!total) return empty

    const bySource: Record<string, number> = {}
    for (const row of db.prepare('SELECT source, COUNT(*) as c FROM session_diagnoses GROUP BY source').all() as Array<{ source: string, c: number }>) {
      bySource[row.source || 'unknown'] = row.c
    }
    const byGrade: Record<string, number> = {}
    for (const row of db.prepare('SELECT grade, COUNT(*) as c FROM session_diagnoses GROUP BY grade').all() as Array<{ grade: string, c: number }>) {
      byGrade[row.grade || 'unknown'] = row.c
    }
    const avg = db.prepare('SELECT AVG(score) as s, AVG(decision_soundness) as ds FROM session_diagnoses').get() as { s: number | null, ds: number | null }
    const frictionSessions = (db.prepare(
      'SELECT COUNT(*) as c FROM session_diagnoses WHERE friction_events_json LIKE \'%{%\''
    ).get() as { c: number }).c

    return {
      total,
      bySource,
      byGrade,
      avgScore: avg.s == null ? null : Math.round(avg.s * 10) / 10,
      avgDecisionSoundness: avg.ds == null ? null : Math.round(avg.ds * 10) / 10,
      frictionSessions
    }
  } catch (err) {
    console.error('[DiagnosisIndex] getDiagnosisSummary failed:', err)
    return empty
  }
}
