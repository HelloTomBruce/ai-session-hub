import { pluginManager } from '../utils/plugin-manager'

export default defineEventHandler(async () => {
  await pluginManager.init()
})
