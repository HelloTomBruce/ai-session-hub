import { knowledgeService } from '../../utils/knowledge-service'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id param' })
  }

  const item = knowledgeService.getItem(id)
  if (!item) {
    throw createError({ statusCode: 404, statusMessage: 'Knowledge item not found' })
  }

  return {
    success: true,
    data: item
  }
})
