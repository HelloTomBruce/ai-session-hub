import { pluginManager } from '~~/server/utils/plugin-manager'

export default defineEventHandler(async () => {
  await pluginManager.init()
  // 会话计数走 SQLite 缓存 COUNT（毫秒级），避免 getSessions() 全语料扫描：
  // 大语料（多平台 GB 级会话文件）下扫描一次 7-10s 且同步阻塞事件循环，
  // 会连带拖慢并发到达的其他接口。缓存不可用时回退实时扫描。
  let cachedCounts: Record<string, number> | undefined
  try {
    cachedCounts = cacheService.getCachedStats().counts
  } catch {
    cachedCounts = undefined
  }
  const plugins = pluginManager.getPluginStatusList(cachedCounts)

  return {
    success: true,
    data: plugins
  }
})
