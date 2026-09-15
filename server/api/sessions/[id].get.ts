import fs from 'node:fs'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const cli = query.cli as CliType

  if (!id || !cli) {
    throw createError({ statusCode: 400, message: 'id and cli query param are required' })
  }

  // 优先使用缓存
  if (cacheService.isAvailable()) {
    const cached = cacheService.getCachedSessionDetail(cli, id)
    if (cached.session) {
      // 检查底层物理文件是否有外部新写入 (mtime 比缓存的 updatedAt 新)
      let needsSync = false
      if (cached.session.rawLocation && fs.existsSync(cached.session.rawLocation)) {
        try {
          const stat = fs.statSync(cached.session.rawLocation)
          if (stat.mtimeMs > (cached.session.updatedAt || 0) + 1000) {
            needsSync = true
          }
        } catch {}
      }

      if (needsSync) {
        const refreshed = cacheService.syncSingleSession(cli, id)
        if (refreshed.session) {
          return {
            success: true,
            data: refreshed,
            source: 'cache_refreshed'
          }
        }
      }

      return {
        success: true,
        data: cached,
        source: 'cache'
      }
    }

    // 缓存中没有该会话，尝试实时单会话同步到缓存
    const synced = cacheService.syncSingleSession(cli, id)
    if (synced.session) {
      return {
        success: true,
        data: synced,
        source: 'cache_initial'
      }
    }
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
