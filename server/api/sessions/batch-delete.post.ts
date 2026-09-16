import type { PlatformType } from '../../utils/types'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const items: Array<{ id: string, cli: string }> = body?.items || []

  if (items.length === 0) {
    throw createError({ statusCode: 400, message: 'No items specified for batch delete' })
  }

  let successCount = 0
  let failCount = 0
  const errors: string[] = []

  for (const item of items) {
    try {
      const ok = deleteCliSession(item.cli as PlatformType, item.id)
      if (ok) {
        successCount++
        // Clean up cache
        if (cacheService.isAvailable()) {
          cacheService.deleteFromCache(item.id, item.cli)
        }
      } else {
        failCount++
        errors.push(`${item.cli}/${item.id}: not found`)
      }
    } catch (err) {
      failCount++
      errors.push(`${item.cli}/${item.id}: ${(err as { message?: string })?.message || 'unknown error'}`)
    }
  }

  return {
    success: true,
    data: { successCount, failCount, errors: errors.slice(0, 20) }
  }
})
