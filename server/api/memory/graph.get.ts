import { memoryService } from '../../utils/memory-service'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const type = query.type as string | undefined
  const project = query.project as string | undefined
  const limit = query.limit ? parseInt(query.limit as string, 10) : 200

  const graph = await memoryService.getGraphData({ type, project, limit })

  return {
    success: true,
    data: graph
  }
})
