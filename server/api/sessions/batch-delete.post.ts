export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const items: Array<{ id: string; cli: string }> = body?.items || []

  if (items.length === 0) {
    throw createError({ statusCode: 400, message: 'No items specified for batch delete' })
  }

  let successCount = 0
  let failCount = 0
  const errors: string[] = []

  for (const item of items) {
    try {
      const ok = deleteCliSession(item.cli as any, item.id)
      if (ok) successCount++
      else {
        failCount++
        errors.push(`${item.cli}/${item.id}: not found`)
      }
    } catch (err: any) {
      failCount++
      errors.push(`${item.cli}/${item.id}: ${err.message || 'unknown error'}`)
    }
  }

  return {
    success: true,
    data: { successCount, failCount, errors: errors.slice(0, 20) }
  }
})
