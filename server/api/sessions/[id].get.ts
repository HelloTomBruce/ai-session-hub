export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const cli = query.cli as CliType

  if (!id || !cli) {
    throw createError({ statusCode: 400, message: 'id and cli query param are required' })
  }

  const result = getSessionMessages(cli, id)
  if (!result.session) {
    throw createError({ statusCode: 404, message: 'Session not found' })
  }

  return {
    success: true,
    data: result
  }
})
