import { mcpRegistry } from '~~/server/utils/mcp-manager-service'
import type { McpServerType } from '~~/server/utils/mcp-manager-types'

interface UpdateServerBody {
  type?: McpServerType
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  disabled?: boolean
}

export default defineEventHandler(async (event) => {
  const platform = getRouterParam(event, 'platform')
  const id = getRouterParam(event, 'id')

  if (!platform || !id) {
    throw createError({ statusCode: 400, message: 'platform and id are required' })
  }

  const body = await readBody<UpdateServerBody>(event)
  if (!body) {
    throw createError({ statusCode: 400, message: 'Request body is required' })
  }

  const result = mcpRegistry.saveServer(platform, { ...body, id }, false)
  if (!result.success) {
    throw createError({ statusCode: 400, message: result.message || 'Failed updating MCP server' })
  }

  return {
    success: true,
    message: 'MCP 服务修改成功'
  }
})
