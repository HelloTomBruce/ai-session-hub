import { knowledgeHarvest } from '../../utils/knowledge-harvest'
import type { ManualInsightInput } from '../../utils/knowledge-harvest'

const TYPE_MAP: Record<string, ManualInsightInput['type']> = {
  adr: 'ADR',
  gotcha: 'Gotcha',
  pattern: 'Pattern',
  milestone: 'Milestone'
}

/**
 * 手工归档入口（复盘页 ADR 归档等）。Rubric v2 起统一写入 Grafeo 记忆图谱，
 * knowledge_vault 不再接收写入；旧 GET/export 接口保持只读。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  if (!body.title || !body.type || !body.platform) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: title, type, platform'
    })
  }

  const type = TYPE_MAP[String(body.type).toLowerCase()]
  if (!type) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unsupported type: ${body.type} (expected adr/gotcha/pattern/milestone)`
    })
  }

  const result = await knowledgeHarvest.captureManual({
    title: String(body.title),
    type,
    summary: typeof body.context === 'string' ? body.context : '',
    solution: typeof body.decision === 'string' ? body.decision : '',
    consequence: typeof body.consequence === 'string' ? body.consequence : '',
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    sessionId: body.sessionId ? String(body.sessionId) : undefined,
    platform: String(body.platform),
    cwd: typeof body.sourceCwd === 'string' && body.sourceCwd ? body.sourceCwd : undefined
  })

  if (result.status !== 'extracted' || !result.item) {
    throw createError({
      statusCode: 422,
      statusMessage: result.reason || '沉淀失败：未形成有效知识内容'
    })
  }

  return {
    success: true,
    dedup: result.dedup,
    data: result.item
  }
})
