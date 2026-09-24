import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer } from '../../utils/mcp-server-instance'

// 兼容 Streamable HTTP 客户端的 GET 独立 SSE 流请求
export default defineEventHandler(async (event) => {
  const req = event.node.req
  const res = event.node.res

  const mcpServer = createMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    // 默认 15s keepalive 会导致流式响应头延迟 15s 才刷新，部分客户端会超时
    keepAliveMs: 2000
  })

  await mcpServer.connect(transport)
  await transport.handleRequest(req, res)
})
