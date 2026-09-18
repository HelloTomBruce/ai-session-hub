import { memoryService } from '../../utils/memory-service'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    query?: string
    cwd?: string
    tech?: string[]
    type?: string
    limit?: number
  }>(event) || {}

  const memories = await memoryService.recallMemories({
    query: body.query,
    cwd: body.cwd,
    tech: body.tech,
    type: body.type,
    limit: body.limit || 10
  })

  return {
    success: true,
    total: memories.length,
    items: memories
  }
})
