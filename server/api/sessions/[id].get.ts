export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const cli = query.cli as CliType

  if (!id || !cli) {
    throw createError({ statusCode: 400, message: 'id and cli query param are required' })
  }

  // 优先使用缓存
  if (cacheService.isAvailable()) {
    const result = cacheService.getCachedSessionDetail(cli, id)
    if (result.session) {
      return {
        success: true,
        data: result,
        source: 'cache'
      }
    }
    // 缓存没有，可能是未同步，回退到直接读取
  }

  const result = getSessionMessages(cli, id)
  if (!result.session) {
    throw createError({ statusCode: 404, message: 'Session not found' })
  }

  return {
    success: true,
    data: result,
    source: 'direct'
  }
})
