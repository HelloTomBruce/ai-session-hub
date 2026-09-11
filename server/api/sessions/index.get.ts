export default defineEventHandler((event) => {
  const query = getQuery(event)
  const cli = query.cli as string | undefined
  const search = (query.q as string || '').toLowerCase().trim()
  const tagFilter = (query.tag as string || '').toLowerCase().trim()

  // 优先使用缓存
  if (cacheService.isAvailable()) {
    let list = cacheService.getCachedSessions(cli, search || undefined)

    // 按标签过滤
    if (tagFilter) {
      list = list.filter(item => {
        const tags = item.extra?.tags || []
        return tags.includes(tagFilter)
      })
    }

    return {
      success: true,
      total: list.length,
      data: list,
      source: 'cache'
    }
  }

  // 回退到直接读取 Adapter
  let list = getAllSessions(cli)

  // 回退模式下如果指定了标签过滤，不支持直接返回空
  if (tagFilter) {
    return { success: true, total: 0, data: [], source: 'direct', note: 'tag_filter_not_supported_in_fallback' }
  }

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
