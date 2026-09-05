import { transports } from './sse.get'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const sessionId = query.sessionId as string

  if (!sessionId) {
    throw createError({ statusCode: 400, message: 'sessionId query param required' })
  }

  const transport = transports.get(sessionId)
  if (!transport) {
    throw createError({ statusCode: 404, message: 'MCP SSE session not found or closed' })
  }

  await transport.handlePostMessage(event.node.req, event.node.res)
})
