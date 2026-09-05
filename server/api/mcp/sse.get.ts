import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { createMcpServer } from '../../utils/mcp-server-instance'

const transports = new Map<string, SSEServerTransport>()
const mcpServer = createMcpServer()

export default defineEventHandler(async (event) => {
  const req = event.node.req
  const res = event.node.res

  const transport = new SSEServerTransport('/api/mcp/message', res)
  const sessionId = transport.sessionId

  transports.set(sessionId, transport)

  req.on('close', () => {
    transports.delete(sessionId)
  })

  await mcpServer.connect(transport)
})

export { transports }
