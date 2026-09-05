export default defineEventHandler(async (event) => {
  const body = await readBody(event) || {}
  const sessionItems: Array<{ platform: PlatformType, id: string }> = body.sessions || []

  if (sessionItems.length === 0) {
    throw createError({ statusCode: 400, message: 'No sessions specified for distillation' })
  }

  const fullData = sessionItems.map(item => {
    const res = adapterRegistry.getMessages(item.platform, item.id)
    if (!res.session) return null
    return res as { session: any, messages: any[] }
  }).filter(Boolean) as any[]

  if (fullData.length === 0) {
    throw createError({ statusCode: 404, message: 'None of the requested sessions were found' })
  }

  const report = distillSessionsContent(fullData)
  return {
    success: true,
    data: report
  }
})
