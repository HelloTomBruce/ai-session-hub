import { pluginManager } from '~~/server/utils/plugin-manager'

export default defineEventHandler(async () => {
  await pluginManager.reload()
  const plugins = pluginManager.getPluginStatusList()

  return {
    success: true,
    message: 'Plugins reloaded successfully',
    data: plugins
  }
})
