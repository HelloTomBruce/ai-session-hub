export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const cli = query.cli as CliType

  if (!id || !cli) {
    throw createError({ statusCode: 400, message: 'id and cli query param are required' })
  }

  const deleted = deleteCliSession(cli, id)

  // Clean up cache if available
  if (deleted && cacheService.isAvailable()) {
    cacheService.deleteFromCache(id, cli)
  }

  return {
    success: deleted,
    message: deleted ? 'Deleted successfully' : 'Failed to delete or session not found'
  }
})
