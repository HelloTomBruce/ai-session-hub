import { cacheService } from '~~/server/utils/cache-service'

export default defineEventHandler(() => {
  const stats = cacheService.getStats()

  return {
    success: true,
    data: stats
  }
})
