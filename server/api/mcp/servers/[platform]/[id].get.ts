export default defineEventHandler((event) => {
  const platform = getRouterParam(event, 'platform')
  const id = getRouterParam(event, 'id')

  if (!platform || !id) {
    throw createError({ statusCode: 400, message: 'platform and id are required' })
  }

  const detail = mcpManagerService.getServerDetail(platform, id)
  if (!detail) {
    throw createError({ statusCode: 404, message: 'MCP server not found' })
  }

  return {
    success: true,
    data: detail
  }
})
