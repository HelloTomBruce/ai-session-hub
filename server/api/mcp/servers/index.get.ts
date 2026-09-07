export default defineEventHandler((event) => {
  const query = getQuery(event)
  const platform = (query.platform as string) || 'all'
  const protocol = (query.protocol as string) || 'all'
  const q = (query.q as string) || ''

  const result = mcpManagerService.getAllServers(platform, protocol, q)

  return {
    success: true,
    total: result.stats.total,
    stats: result.stats,
    data: result.servers
  }
})
