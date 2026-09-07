import { PLATFORMS_META } from '~~/server/utils/platform-meta'

export default defineEventHandler(() => {
  return {
    success: true,
    data: Object.values(PLATFORMS_META)
  }
})
