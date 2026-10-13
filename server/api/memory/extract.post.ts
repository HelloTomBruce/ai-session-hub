import { extractMemoryFromSession, type ExtractedMemory } from '../../utils/memory-extractor'
import { memoryService } from '../../utils/memory-service'
import type { MemoryExtractInput, MemoryGraphItem } from '../../utils/memory-types'

/** 证据锚定处置（P1+P2）：编造嫌疑 → 降置信并标 draft；补齐会话溯源 */
function applyEvidenceVerdict(extracted: ExtractedMemory, origin?: { sessionId?: string, platform?: string }): Partial<MemoryGraphItem> {
  const { evidenceVerified, ...rest } = extracted
  const sourceMeta: MemoryGraphItem['sourceMeta'] = {
    ...rest.sourceMeta,
    evidenceVerified,
    ...(origin?.sessionId ? { sessionId: origin.sessionId, sessionTitle: extracted.title } : {})
  }
  // 有引文但全部校验失败：编造嫌疑 → 低置信 + draft（不进召回，memory 页可人工确认提升）
  if (evidenceVerified.total > 0 && evidenceVerified.passed === 0) {
    return { ...rest, sourceMeta, confidence: Math.min(rest.confidence ?? 90, 45), status: 'draft' }
  }
  return { ...rest, sourceMeta }
}

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
      let dedupInfo = null
      if (autoSave && extracted.title && extracted.content) {
        sendEvent('status', { message: '正在写入 Grafeo 图数据库...' })
        // 证据锚定处置：有引文但全部校验失败 → 编造嫌疑，降置信
        const draft = applyEvidenceVerdict(extracted, { sessionId: body.sessionId, platform: body.platform })
        const result = await memoryService.saveMemoryWithDedup(
          draft as Partial<MemoryGraphItem> & { title: string, content: string },
          body.sessionId ? { sessionId: body.sessionId, platform: body.platform || '' } : undefined
        )
        savedItem = result.item
        dedupInfo = result.dedup
      }

      sendEvent('done', {
        extracted,
        savedItem,
        dedup: dedupInfo
      })
      res.end()
    } catch (err) {
      sendEvent('error', { message: err instanceof Error ? err.message : '记忆提炼失败' })
      res.end()
    }
    return
  }

  // 非流式单次提取
  try {
    const extracted = await extractMemoryFromSession(body)
    let savedItem = null
    let dedupInfo = null
    if (autoSave && extracted.title && extracted.content) {
      const draft = applyEvidenceVerdict(extracted, { sessionId: body.sessionId, platform: body.platform })
      const result = await memoryService.saveMemoryWithDedup(
        draft as Partial<MemoryGraphItem> & { title: string, content: string },
        body.sessionId ? { sessionId: body.sessionId, platform: body.platform || '' } : undefined
      )
      savedItem = result.item
      dedupInfo = result.dedup
    }

    return {
      success: true,
      extracted,
      savedItem,
      dedup: dedupInfo
    }
  } catch (err) {
    throw createError({
      statusCode: 500,
      statusMessage: err instanceof Error ? err.message : '记忆提炼失败'
    })
  }
})
