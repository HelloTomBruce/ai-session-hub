import { pluginManager } from '~~/server/utils/plugin-manager'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Plugin ID is required'
    })
  }

  const body = await readBody<{ enabled?: boolean }>(event).catch(() => ({ enabled: undefined }))
  await pluginManager.init()

  const newState = pluginManager.togglePlugin(id, body?.enabled)

  return {
    success: true,
    data: {
      id,
      enabled: newState
    }
  }
})
