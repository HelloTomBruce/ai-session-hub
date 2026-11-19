import { memoryService } from '../../utils/memory-service'
import type { MemoryGraphItem } from '../../utils/memory-types'

export default defineEventHandler(async (event) => {
  const raw = await readJsonBody<Partial<MemoryGraphItem>>(event)

  // 入参校验：标题/内容必填且有长度上限（此前只判空，超长内容会直接进图库）
  const title = requireString(raw.title, { field: 'title', min: 1, max: 200 })
  const content = requireString(raw.content, { field: 'content', min: 1, max: 100_000 })
  const type = optionalString(raw.type, { field: 'type', max: 40 })
  const summary = optionalString(raw.summary, { field: 'summary', max: 2_000 })
  const tags = raw.tags === undefined ? undefined : requireStringArray(raw.tags, { field: 'tags', max: 40, maxItems: 20 })
  const techConcepts = raw.techConcepts
  const projects = raw.projects
  const problems = raw.problems

  try {
    const result = await memoryService.saveMemoryWithDedup(
      {
        ...raw,
        title,
        content,
        ...(type ? { type } : {}),
        ...(summary ? { summary } : {}),
        ...(tags ? { tags } : {}),
        ...(techConcepts ? { techConcepts } : {}),
        ...(projects ? { projects } : {}),
        ...(problems ? { problems } : {})
      },
      raw.sourceMeta?.sessionId
        ? { sessionId: raw.sourceMeta.sessionId, platform: raw.sourceMeta.platform || '' }
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
