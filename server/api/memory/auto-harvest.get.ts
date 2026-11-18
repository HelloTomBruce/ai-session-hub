import { autoHarvestService } from '../../utils/auto-harvest'

export default defineEventHandler(() => {
  const stats = autoHarvestService.getHarvestStats()
  return {
    success: true,
    ...stats
  }
})
