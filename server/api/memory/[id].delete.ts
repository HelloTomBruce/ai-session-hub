import { memoryService } from '../../utils/memory-service'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: '缺少记忆 ID' })
  }

  const deleted = await memoryService.deleteMemory(id)
  return {
    success: deleted
  }
})
