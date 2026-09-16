import { adapterRegistry } from '../../utils/adapter-registry'
import { getLLMProviderSettings } from '../../utils/llm-provider-config'
import { distillSessionsContentStream, type DistillReport } from '../../utils/distillator'
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

  // Set SSE Headers
  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')

  const res = event.node.res

  const sendEvent = (eventType: string, data: unknown) => {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const provider = getLLMProviderSettings()

    await distillSessionsContentStream(
      fullData,
      provider,
      (status: { message: string, step?: number, totalSteps?: number, currentSession?: string }) => {
        sendEvent('status', status)
      },
      (chunk: string) => {
        sendEvent('chunk', { text: chunk })
      },
      (finalReport: DistillReport) => {
        sendEvent('done', { report: finalReport })
        res.end()
      },
      (progress) => {
        sendEvent('map-progress', { sessions: progress })
      },
      (sessionId: string, text: string) => {
        sendEvent('map-chunk', { sessionId, text })
      }
    )
  } catch (err) {
    sendEvent('error', { message: (err as { message?: string })?.message || '提炼失败' })
    res.end()
  }
})
