import { mcpLogger } from '../../utils/mcp-logger'

export default defineEventHandler(() => {
  return {
    success: true,
    data: mcpLogger.getLogs()
  }
})
