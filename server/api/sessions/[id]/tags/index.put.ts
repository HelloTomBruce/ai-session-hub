export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const platform = (query.cli as string) || ''
  if (!id || !platform) throw createError({ statusCode: 400, message: 'id and cli required' })

  const body = await readJsonBody(event)
  const tags = body.tags === undefined ? [] : requireStringArray(body.tags, { field: 'tags', max: 40, maxItems: 20 })

  const ok = tagService.setSessionTags(id, platform, tags)
  return { success: ok }
})
