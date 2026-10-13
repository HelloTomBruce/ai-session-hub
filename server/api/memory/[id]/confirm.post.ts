import { memoryService } from '../../../utils/memory-service'

/**
 * P2 状态提升：draft → confirmed。
 * draft（低置信/证据存疑，被召回质量门排除）经人工确认后进入召回池。
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Memory ID is required' })
  }

  const ok = await memoryService.confirmMemory(id)
  if (!ok) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to confirm memory' })
  }

  return { success: true, id, status: 'confirmed' }
})
