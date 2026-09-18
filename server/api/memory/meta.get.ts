import { memoryService } from '../../utils/memory-service'

export default defineEventHandler(async () => {
  const meta = await memoryService.getDistinctMeta()
  return {
    success: true,
    data: meta
  }
})
