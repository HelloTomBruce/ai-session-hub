import { mcpRegistry } from '~~/server/utils/mcp-providers/mcp-provider-registry'
import type { McpServerType } from '~~/server/utils/mcp-manager-types'

interface CreateServerBody {
  platform: string
  id: string
  type: McpServerType
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  disabled?: boolean
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateServerBody>(event)
  if (!body || !body.platform || !body.id || !body.type) {
    throw createError({ statusCode: 400, message: 'platform, id, and type are required' })
  }

  const result = mcpRegistry.saveServer(body.platform, body, true)
  if (!result.success) {
    throw createError({ statusCode: 400, message: result.message || 'Failed creating MCP server' })
  }

  return {
    success: true,
    message: 'MCP 服务添加成功'
  }
})
