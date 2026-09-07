import { mcpRegistry } from '~~/server/utils/mcp-manager-service'

export default defineEventHandler((event) => {
  const platform = getRouterParam(event, 'platform')
  const id = getRouterParam(event, 'id')

  if (!platform || !id) {
    throw createError({ statusCode: 400, message: 'platform and id are required' })
  }

  const result = mcpRegistry.deleteServer(platform, id)
  if (!result.success) {
    throw createError({ statusCode: 400, message: result.message || 'Failed deleting MCP server' })
  }

  return {
    success: true,
    message: 'MCP 服务已删除'
  }
})
