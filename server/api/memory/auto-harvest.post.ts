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

  const limit = requireInt(body.limit, { field: 'limit', min: 1, max: 200, fallback: 20 })
  const platform = optionalString(body.platform, { field: 'platform', max: 40 })
  const sessionId = optionalString(body.sessionId, { field: 'sessionId', max: 200 })
  const force = optionalBool(body.force, 'force')

  // 支持单个会话立即收割
  if (sessionId && platform) {
    const record = await autoHarvestService.harvestSession(platform, sessionId, force)
    return {
      success: true,
      single: true,
      record
    }
  }

  // 批量收割
  const result = await autoHarvestService.batchHarvest({
    limit,
    platform,
    force
  })

  return {
    success: true,
    single: false,
    ...result
  }
})
