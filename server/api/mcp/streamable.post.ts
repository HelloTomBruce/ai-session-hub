import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from '../../utils/mcp-server-instance'

export default defineEventHandler(async (event) => {
  const req = event.node.req
  const res = event.node.res
  const body = await readBody(event)

  // 无状态模式：每个请求独立处理，无需 session 管理（本地单用户场景足够）
  const mcpServer = createMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    // 默认 15s keepalive 会导致流式响应头延迟 15s 才刷新，部分客户端会超时
    keepAliveMs: 2000
  })

  await mcpServer.connect(transport)
  await transport.handleRequest(req, res, body)
})
