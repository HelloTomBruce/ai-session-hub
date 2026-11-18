import { autoHarvestService } from '../../utils/auto-harvest'

interface AutoHarvestRequestBody {
  limit?: number
  platform?: string
  sessionId?: string
  force?: boolean
}

export default defineEventHandler(async (event) => {
  const rawBody = await readBody(event).catch(() => ({}))
  const body: AutoHarvestRequestBody = (rawBody && typeof rawBody === 'object') ? rawBody : {}

  // 支持单个会话立即收割
  if (body.sessionId && body.platform) {
    const record = await autoHarvestService.harvestSession(body.platform, body.sessionId, body.force)
    return {
      success: true,
      single: true,
      record
    }
  }

  // 批量收割
  const result = await autoHarvestService.batchHarvest({
    limit: body.limit,
    platform: body.platform,
    force: body.force
  })

  return {
    success: true,
    single: false,
    ...result
  }
})
