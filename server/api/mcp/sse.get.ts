import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { createMcpServer } from '../../utils/mcp-server-instance'

const transports = new Map<string, SSEServerTransport>()

export default defineEventHandler(async (event) => {
  const res = event.node.res

  // 每个 SSE 连接创建独立的 Server 实例：
  // MCP SDK 的 Server.connect() 不允许重复连接，单例会导致并发/重连客户端 500
  const mcpServer = createMcpServer()
  const transport = new SSEServerTransport('/api/mcp/message', res)
  const sessionId = transport.sessionId

  transports.set(sessionId, transport)

  res.on('close', () => {
    transports.delete(sessionId)
  })

  await mcpServer.connect(transport)
})

export { transports }
