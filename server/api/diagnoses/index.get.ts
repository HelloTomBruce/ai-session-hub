import { getDiagnosisSummary, listDiagnoses } from '../../utils/diagnosis-index'

/**
 * 诊断索引：结果侧数据集（召回效果度量地基）。
 * GET /api/diagnoses?cwd=&limit= → 汇总 + 会话诊断行。
 */
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const cwd = query.cwd ? String(query.cwd) : undefined
  const limit = query.limit ? parseInt(query.limit as string, 10) : 100

  return {
    success: true,
    summary: getDiagnosisSummary(),
    data: listDiagnoses({ cwd, limit: Number.isFinite(limit) ? limit : 100 })
  }
})
