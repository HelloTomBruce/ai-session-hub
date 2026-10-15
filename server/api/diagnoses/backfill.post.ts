import { backfillDiagnoses } from '../../utils/diagnosis-index'

/**
 * 存量回填：为尚未索引的会话补写诊断结果（结果侧基线），
 * 供召回效果度量 JOIN 分析。幂等：已索引会话跳过；仅在缺失时补写，不覆盖真实诊断。
 * 分批执行，返回 remaining 供再次调用直到收敛。
 */
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const limit = query.limit ? parseInt(query.limit as string, 10) : 200
  const result = backfillDiagnoses(Number.isFinite(limit) ? limit : 200)
  return {
    success: true,
    ...result
  }
})
