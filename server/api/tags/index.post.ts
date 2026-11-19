export default defineEventHandler(async (event) => {
  const body = await readJsonBody(event)
  const name = requireString(body.name, { field: 'name', min: 1, max: 40 })
  const color = optionalString(body.color, { field: 'color', max: 32 })
  const category = optionalString(body.category, { field: 'category', max: 10, oneOf: ['auto', 'manual', 'ai'] as const })

  const tag = tagService.createTag(name, color, category)
  return { success: true, data: tag }
})
