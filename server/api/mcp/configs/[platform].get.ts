import { mcpRegistry } from '~~/server/utils/mcp-manager-service'

export default defineEventHandler((event) => {
  const platform = getRouterParam(event, 'platform')
  if (!platform) {
    throw createError({ statusCode: 400, message: 'platform is required' })
  }

  const config = mcpRegistry.getConfigByPlatform(platform)
  if (!config) {
    throw createError({ statusCode: 404, message: `MCP config for platform '${platform}' not found` })
  }

  return {
    success: true,
    data: config
  }
})
