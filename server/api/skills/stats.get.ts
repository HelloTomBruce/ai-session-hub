export default defineEventHandler(() => {
  const stats = skillService.getStats()
  return {
    success: true,
    data: stats
  }
})
