import { mcpRegistry } from '~~/server/utils/mcp-providers/mcp-provider-registry'

interface ToggleBody {
  disabled: boolean
}

export default defineEventHandler(async (event) => {
  const platform = getRouterParam(event, 'platform')
  const id = getRouterParam(event, 'id')

  if (!platform || !id) {
    throw createError({ statusCode: 400, message: 'platform and id are required' })
  }

  const body = await readBody<ToggleBody>(event)
  if (body === undefined || body.disabled === undefined) {
    throw createError({ statusCode: 400, message: 'disabled is required' })
  }

  const result = mcpRegistry.toggleServer(platform, id, Boolean(body.disabled))
  if (!result.success) {
    throw createError({ statusCode: 400, message: result.message || 'Failed toggling MCP server' })
  }

  return {
    success: true,
    message: body.disabled ? 'MCP 服务已禁用' : 'MCP 服务已启用'
  }
})
