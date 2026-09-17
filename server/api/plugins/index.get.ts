import { pluginManager } from '~~/server/utils/plugin-manager'

export default defineEventHandler(async () => {
  await pluginManager.init()
  const plugins = pluginManager.getPluginStatusList()

  return {
    success: true,
    data: plugins
  }
})
