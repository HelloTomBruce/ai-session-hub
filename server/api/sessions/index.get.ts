export default defineEventHandler((event) => {
  const query = getQuery(event)
  const cli = query.cli as string | undefined
  const search = (query.q as string || '').toLowerCase().trim()

  // 优先使用缓存
  if (cacheService.isAvailable()) {
    const list = cacheService.getCachedSessions(cli, search || undefined)
    return {
      success: true,
      total: list.length,
      data: list,
      source: 'cache'
    }
  }

  // 回退到直接读取 Adapter
  let list = getAllSessions(cli)

  if (search) {
    list = list.filter(item =>
      item.title.toLowerCase().includes(search) ||
      item.cwd.toLowerCase().includes(search) ||
      item.id.toLowerCase().includes(search) ||
      (item.model && item.model.toLowerCase().includes(search))
    )
  }

  return {
    success: true,
    total: list.length,
    data: list,
    source: 'direct'
  }
})
