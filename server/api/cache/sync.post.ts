import { cacheService } from '~~/server/utils/cache-service'

export default defineEventHandler(async (event) => {
  const { force } = getQuery(event)
  const result = force === 'true' ? cacheService.rebuildAll() : cacheService.syncAll()

  return {
    success: true,
    data: {
      result,
      stats: cacheService.getStats()
    }
  }
})
