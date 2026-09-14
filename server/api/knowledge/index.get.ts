import { knowledgeService } from '../../utils/knowledge-service'

export default defineEventHandler((event) => {
  const query = getQuery(event)

  const type = query.type ? String(query.type) : undefined
  const tag = query.tag ? String(query.tag) : undefined
  const platform = query.platform ? String(query.platform) : undefined
  const search = query.search ? String(query.search) : undefined
  const limit = query.limit ? parseInt(String(query.limit), 10) : 50
  const offset = query.offset ? parseInt(String(query.offset), 10) : 0

  const result = knowledgeService.listItems({
    type,
    tag,
    platform,
    search,
    limit,
    offset
  })

  return {
    success: true,
    data: result.items,
    total: result.total,
    limit,
    offset
  }
})
