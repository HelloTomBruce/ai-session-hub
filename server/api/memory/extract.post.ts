import { extractMemoryFromSession } from '../../utils/memory-extractor'
import { memoryService } from '../../utils/memory-service'
import type { MemoryExtractInput } from '../../utils/memory-types'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const isStream = query.stream === 'true'
  const autoSave = query.autoSave === 'true'

  const body = await readBody<MemoryExtractInput>(event)
  if (!body || !body.messagesContent) {
    throw createError({
      statusCode: 400,
      statusMessage: '缺少 messagesContent 会话内容'
    })
  }

  if (isStream) {
    setHeader(event, 'Content-Type', 'text/event-stream')
    setHeader(event, 'Cache-Control', 'no-cache')
    setHeader(event, 'Connection', 'keep-alive')

    const res = event.node.res
    const sendEvent = (eventType: string, data: unknown) => {
      res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      sendEvent('status', { message: '正在分析会话内容与代码模式...' })

      const extracted = await extractMemoryFromSession(body, (chunk) => {
        sendEvent('chunk', { text: chunk })
      })

      sendEvent('status', { message: '提取完成，正在组织图谱实体...' })

      let savedItem = null
      if (autoSave && extracted.title && extracted.content) {
        sendEvent('status', { message: '正在写入 Grafeo 图数据库...' })
        savedItem = await memoryService.saveMemory(extracted as any)
      }

      sendEvent('done', {
        extracted,
        savedItem
      })
      res.end()
    } catch (err: any) {
      sendEvent('error', { message: err?.message || '记忆提炼失败' })
      res.end()
    }
    return
  }

  // 非流式单次提取
  try {
    const extracted = await extractMemoryFromSession(body)
    let savedItem = null
    if (autoSave && extracted.title && extracted.content) {
      savedItem = await memoryService.saveMemory(extracted as any)
    }

    return {
      success: true,
      extracted,
      savedItem
    }
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: err?.message || '记忆提炼失败'
    })
  }
})
