export default defineEventHandler(() => {
  if (cacheService.isAvailable()) {
    return {
      success: true,
      data: cacheService.getCachedStats()
    }
  }

  const stats = getStats()
  return {
    success: true,
    data: stats
  }
})
