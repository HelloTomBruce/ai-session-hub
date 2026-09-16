import type { PlatformType, SessionMessage, UnifiedSession } from '../../utils/types'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ sessions?: Array<{ platform: PlatformType, id: string }> }>(event) || {}
  const sessionItems: Array<{ platform: PlatformType, id: string }> = body.sessions || []

  if (sessionItems.length === 0) {
    throw createError({ statusCode: 400, message: 'No sessions specified for distillation' })
  }

  const fullData = sessionItems.map((item) => {
    const res = adapterRegistry.getMessages(item.platform, item.id)
    if (!res.session) return null
    return res
  }).filter(Boolean) as Array<{ session: UnifiedSession, messages: SessionMessage[] }>

  if (fullData.length === 0) {
    throw createError({ statusCode: 404, message: 'None of the requested sessions were found' })
  }

  const provider = getLLMProviderSettings()
  const report = await distillSessionsContent(fullData, provider)
  return {
    success: true,
    data: report
  }
})
