import { knowledgeService } from '../../../utils/knowledge-service'
import type { PlatformType } from '../../../utils/types'

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const platform = (query.platform ? String(query.platform) : 'pi') as PlatformType

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing session id' })
  }

  const evaluation = knowledgeService.getEvaluation(id, platform)

  return {
    success: true,
    data: evaluation
  }
})
