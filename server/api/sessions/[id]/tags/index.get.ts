export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const platform = (query.cli as string) || ''
  if (!id || !platform) throw createError({ statusCode: 400, message: 'id and cli required' })

  const tags = tagService.getSessionTags(id, platform)
  return { success: true, data: tags }
})
