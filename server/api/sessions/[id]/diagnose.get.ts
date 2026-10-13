import { fileReportStore } from '../../../utils/diagnosis-service'

export default defineEventHandler((event) => {
  const sessionId = getRouterParam(event, 'id')
  if (!sessionId) {
    throw createError({ statusCode: 400, message: 'Session ID is required' })
  }

  const parsed = fileReportStore.load(sessionId)
  return {
    success: true,
    hasSavedReport: parsed !== null,
    data: parsed
  }
})
