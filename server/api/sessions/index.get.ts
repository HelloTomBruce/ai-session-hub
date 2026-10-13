export default defineEventHandler((event) => {
  const query = getQuery(event)
  const cli = query.cli as string | undefined
  const search = (query.q as string || '').toLowerCase().trim()
  const tagFilter = (query.tag as string || '').toLowerCase().trim()

  // 优先使用缓存
  if (cacheService.isAvailable()) {
    // 列表入口显式封顶，防止会话总量增长后响应体无界膨胀；
    // total 由独立 COUNT 查询给出，不受截断影响。
    const listLimit = 2000
    let list = cacheService.getCachedSessions(cli, search || undefined, { limit: listLimit })
    const totalCount = cacheService.countCachedSessions(cli, search || undefined)

    // 按标签过滤：标签是 extra 中的 JSON 数组，只能在应用层过滤。
    // 已知限制：标签过滤作用于截断后的窗口，超 2000 条命中时尾部会话不参与过滤。
    if (tagFilter) {
      list = list.filter((item) => {
        const tags = (item.extra?.tags as string[] | undefined) || []
        return tags.includes(tagFilter)
      })
    }

    try {
      tagService.mergeTagsToSessions(list)
    } catch {
      // ignore tag merge failures
    }
    try {
      markDiagnosedSessions(list)
    } catch {
      // ignore diagnosis marker failures
    }

    return {
      success: true,
      // 标签过滤无法用 SQL 精确计数，total 退回到窗口内过滤后的数量
      total: tagFilter ? list.length : totalCount,
      data: list,
      source: 'cache',
      truncated: tagFilter ? false : list.length < totalCount
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
      item.title.toLowerCase().includes(search)
      || item.cwd.toLowerCase().includes(search)
      || item.id.toLowerCase().includes(search)
      || (item.model && item.model.toLowerCase().includes(search))
    )
    // Merge tags from cache
    try {
      tagService.mergeTagsToSessions(list)
    } catch {
      // ignore tag merge failures
    }
  }

  try {
    tagService.mergeTagsToSessions(list)
  } catch {
    // ignore tag merge failures
  }
  try {
    markDiagnosedSessions(list)
  } catch {
    // ignore diagnosis marker failures
  }

  return {
    success: true,
    total: list.length,
    data: list,
    source: 'direct'
  }
})
