export default defineEventHandler((event) => {
  const query = getQuery(event)
  const platform = (query.platform as string) || 'all'
  const q = (query.q as string) || ''

  const result = skillService.getAllSkills(platform, q)

  return {
    success: true,
    total: result.total,
    stats: result.stats,
    data: result.skills
  }
})
