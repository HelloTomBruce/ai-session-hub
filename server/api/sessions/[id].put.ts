export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const cli = query.cli as CliType
  const body = await readJsonBody(event)

  if (!id || !cli) {
    throw createError({ statusCode: 400, message: 'id and cli query param are required' })
  }

  // 只允许修改标题，且长度受控（此前 body 直接透传给 adapter）
  const title = requireString(body.title, { field: 'title', min: 1, max: 300 })
  const payload = { title }
  const updated = updateCliSession(cli, id, payload)

  if (updated && cacheService.isAvailable()) {
    cacheService.updateSessionTitle(id, cli, title)
  }

  return {
    success: updated,
    message: updated ? 'Updated successfully' : 'Update not supported for this CLI file type or not found'
  }
})
