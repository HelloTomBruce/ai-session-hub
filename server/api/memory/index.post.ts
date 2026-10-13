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
    const result = await memoryService.saveMemoryWithDedup(
      {
        ...body,
        title: body.title,
        content: body.content
      },
      body.sourceMeta?.sessionId
        ? { sessionId: body.sourceMeta.sessionId, platform: body.sourceMeta.platform || '' }
        : undefined
    )

    return {
      success: true,
      item: result.item,
      dedup: result.dedup
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw createError({
      statusCode: 500,
      statusMessage: `保存记忆失败: ${message}`
    })
  }
})
