import { mcpLogger } from '../../utils/mcp-logger'

export default defineEventHandler(() => {
  mcpLogger.clearLogs()
  return {
    success: true
  }
})
