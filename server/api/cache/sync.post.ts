import { cacheService } from '~~/server/utils/cache-service'

export default defineEventHandler(async () => {
  const result = cacheService.syncAll()

  return {
    success: true,
    data: {
      result,
      stats: cacheService.getStats()
    }
  }
})
