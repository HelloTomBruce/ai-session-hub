import { memoryService } from '../../utils/memory-service'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: '缺少记忆 ID' })
  }

  const item = await memoryService.getMemory(id)
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: '未找到指定记忆' })
  }

  return {
    success: true,
    item
  }
})
