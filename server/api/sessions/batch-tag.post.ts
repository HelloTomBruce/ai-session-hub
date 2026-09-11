export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const items: Array<{ id: string; cli: string }> = body?.items || []
  const tags: string[] = body?.tags || []
  const mode: 'add' | 'set' | 'remove' = body?.mode || 'add'

  if (items.length === 0) throw createError({ statusCode: 400, message: 'No items specified' })
  if (tags.length === 0) throw createError({ statusCode: 400, message: 'No tags specified' })

  // Ensure all tags exist in tag_defs
  for (const tag of tags) {
    tagService.createTag(tag)
  }

  let successCount = 0
  const results: Array<{ id: string; cli: string; tags: string[]; ok: boolean }> = []

  for (const item of items) {
    try {
      const current = tagService.getSessionTags(item.id, item.cli)
      let updated: string[]

      if (mode === 'add') {
        updated = [...new Set([...current, ...tags])]
      } else if (mode === 'remove') {
        updated = current.filter((t: string) => !tags.includes(t))
      } else {
        updated = tags
      }

      const ok = tagService.setSessionTags(item.id, item.cli, updated)
      if (ok) successCount++
      results.push({ id: item.id, cli: item.cli, tags: updated, ok })
    } catch {}
  }

  return { success: true, data: { successCount, total: items.length, results } }
})
