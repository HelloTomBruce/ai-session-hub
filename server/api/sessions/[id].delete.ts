import type { CliType } from '~~/server/utils/types'
import { cacheService } from '~~/server/utils/cache-service'
import { deleteCliSession } from '~~/server/utils/session-service'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const cli = query.cli as CliType

  if (!id || !cli) {
    throw createError({ statusCode: 400, message: 'id and cli query param are required' })
  }

  try {
    deleteCliSession(cli, id)
  } catch (err) {
    console.warn(`[DeleteSession] Warning deleting from adapter ${cli}/${id}:`, err)
  }

  // Always clean up cache if available so ghost/stale sessions don't get stuck in UI
  if (cacheService.isAvailable()) {
    cacheService.deleteFromCache(id, cli)
  }

  return {
    success: true,
    message: 'Deleted successfully'
  }
})
