export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body?.name?.trim()) {
    throw createError({ statusCode: 400, message: 'Tag name is required' })
  }

  const tag = tagService.createTag(body.name.trim(), body.color, body.category)
  return { success: true, data: tag }
})
