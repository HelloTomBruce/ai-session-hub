import { memoryService } from '../../utils/memory-service'

export default defineEventHandler(async (event) => {
  const body = await readJsonBody(event)

  const memories = await memoryService.recallMemories({
    query: optionalString(body.query, { field: 'query', max: 500 }),
    cwd: optionalString(body.cwd, { field: 'cwd', max: 1000 }),
    tech: body.tech === undefined ? undefined : requireStringArray(body.tech, { field: 'tech', max: 60, maxItems: 20 }),
    type: optionalString(body.type, { field: 'type', max: 40 }),
    limit: requireInt(body.limit, { field: 'limit', min: 1, max: 50, fallback: 10 }),
    source: 'rest'
  })

  return {
    success: true,
    total: memories.length,
    items: memories
  }
})
