export default defineEventHandler(() => {
  const stats = getStats()
  return {
    success: true,
    data: stats
  }
})
