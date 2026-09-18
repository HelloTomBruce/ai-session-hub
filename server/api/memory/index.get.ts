import { memoryService } from '../../utils/memory-service'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const type = query.type as string | undefined
  const project = query.project as string | undefined
  const cwd = query.cwd as string | undefined
  const tech = query.tech as string | undefined
  const search = query.search as string | undefined
  const limit = query.limit ? parseInt(query.limit as string, 10) : 50
  const offset = query.offset ? parseInt(query.offset as string, 10) : 0

  const result = await memoryService.listMemories({
    type,
    project,
    cwd,
    tech,
    search,
    limit,
    offset
  })

  return {
    success: true,
    total: result.total,
    items: result.items
  }
})
