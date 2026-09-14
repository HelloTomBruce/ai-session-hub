import { knowledgeService } from '../../utils/knowledge-service'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id param' })
  }

  const deleted = knowledgeService.deleteItem(id)
  return {
    success: deleted
  }
})
