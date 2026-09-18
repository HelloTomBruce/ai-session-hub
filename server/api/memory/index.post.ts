import { memoryService } from '../../utils/memory-service'
import type { MemoryGraphItem } from '../../utils/memory-types'

export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<MemoryGraphItem>>(event)

  if (!body || !body.title || !body.content) {
    throw createError({
      statusCode: 400,
      statusMessage: '记忆标题 (title) 和内容 (content) 不能为空'
    })
  }

  try {
    const saved = await memoryService.saveMemory({
      ...body,
      title: body.title,
      content: body.content
    })

    return {
      success: true,
      item: saved
    }
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: `保存记忆失败: ${err?.message || err}`
    })
  }
})
