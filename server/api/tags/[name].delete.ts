export default defineEventHandler((event) => {
  const name = getRouterParam(event, 'name')
  if (!name) throw createError({ statusCode: 400, message: 'Tag name is required' })

  tagService.deleteTag(name)
  return { success: true }
})
