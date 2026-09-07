import { mcpRegistry } from '~~/server/utils/mcp-manager-service'

interface UpdateConfigBody {
  content: string
}

export default defineEventHandler(async (event) => {
  const platform = getRouterParam(event, 'platform')
  if (!platform) {
    throw createError({ statusCode: 400, message: 'platform is required' })
  }

  const body = await readBody<UpdateConfigBody>(event)
  if (!body || typeof body.content !== 'string') {
    throw createError({ statusCode: 400, message: 'content must be a string' })
  }

  const result = mcpRegistry.saveConfig(platform, body.content)
  if (!result.success) {
    throw createError({ statusCode: 400, message: result.message || 'Failed saving config' })
  }

  return {
    success: true,
    message: '配置文件保存成功'
  }
})
