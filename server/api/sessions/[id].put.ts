export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const cli = query.cli as CliType
  const body = await readBody(event)

  if (!id || !cli) {
    throw createError({ statusCode: 400, message: 'id and cli query param are required' })
  }

  const updated = updateCliSession(cli, id, body)

  if (updated && cacheService.isAvailable() && body.title) {
    cacheService.updateSessionTitle(id, cli, body.title)
  }

  return {
    success: updated,
    message: updated ? 'Updated successfully' : 'Update not supported for this CLI file type or not found'
  }
})
