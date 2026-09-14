import { knowledgeService } from '../../utils/knowledge-service'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  if (!body.title || !body.type || !body.platform) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: title, type, platform'
    })
  }

  const saved = knowledgeService.saveItem(body)

  return {
    success: true,
    data: saved
  }
})
