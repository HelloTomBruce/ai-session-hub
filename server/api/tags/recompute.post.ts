import { tagService } from '~~/server/utils/tag-service'

/**
 * 存量标签重算：修正历史上被泛词 includes() 污染的全量标签。
 * 只覆盖 auto 标签，用户手工/`ai` 标签保留；limit 控制单次处理量，可反复调用直到收敛。
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const limit = requireInt(query.limit, { field: 'limit', min: 1, max: 10000, fallback: 5000 })

  const result = tagService.recomputeAllSessionTags(limit)

  return {
    success: result.errors === 0,
    ...result
  }
})
