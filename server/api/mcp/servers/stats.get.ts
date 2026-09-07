export default defineEventHandler(() => {
  const stats = mcpManagerService.getStats()
  return {
    success: true,
    data: stats
  }
})
