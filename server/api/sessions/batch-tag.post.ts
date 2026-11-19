export default defineEventHandler(async (event) => {
  const body = await readJsonBody(event)
  const items = requireEntityRefs(body.items, { field: 'items', maxItems: 500 })
  const tags = requireStringArray(body.tags, { field: 'tags', max: 40, maxItems: 20 })
  const mode = optionalString(body.mode, { field: 'mode', max: 10, oneOf: ['add', 'set', 'remove'] as const }) || 'add'

  if (items.length === 0) throw createError({ statusCode: 400, message: 'No items specified' })
  if (tags.length === 0) throw createError({ statusCode: 400, message: 'No tags specified' })

  // Ensure all tags exist in tag_defs
  for (const tag of tags) {
    tagService.createTag(tag)
  }

  let successCount = 0
  let syncNeededCount = 0
  const results: Array<{ id: string, cli: string, tags: string[], ok: boolean }> = []

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
      else syncNeededCount++
      results.push({ id: item.id, cli: item.cli, tags: updated, ok })
    } catch {
      syncNeededCount++
    }
  }

  const message = syncNeededCount > 0
    ? `已标记 ${successCount} 个，${syncNeededCount} 个不在缓存中。请先点击"同步"按钮将会话加载到缓存后重试。`
    : `已为 ${successCount} 个会话打上标签`

  return { success: true, data: { successCount, syncNeededCount, results }, message }
})
