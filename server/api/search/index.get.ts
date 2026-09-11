import { cacheService } from '~~/server/utils/cache-service'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const q = (query.q as string || '').trim()
  const limit = parseInt((query.limit as string) || '20', 10)
  const offset = parseInt((query.offset as string) || '0', 10)

  if (!q) {
    throw createError({ statusCode: 400, message: 'Search query (q) is required' })
  }

  if (!cacheService.isAvailable()) {
    throw createError({ statusCode: 503, message: 'Cache not initialized. Please sync first (POST /api/cache/sync)' })
  }

  const result = cacheService.search(q, limit, offset)

  return {
    success: true,
    data: result
  }
})
