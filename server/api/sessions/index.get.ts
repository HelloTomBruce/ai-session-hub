export default defineEventHandler((event) => {
  const query = getQuery(event)
  const cli = query.cli as string | undefined
  const search = (query.q as string || '').toLowerCase().trim()

  let list = getAllSessions(cli)

  if (search) {
    list = list.filter(item => 
      item.title.toLowerCase().includes(search) ||
      item.cwd.toLowerCase().includes(search) ||
      item.id.toLowerCase().includes(search) ||
      (item.model && item.model.toLowerCase().includes(search))
    )
  }

  return {
    success: true,
    total: list.length,
    data: list
  }
})
