import { mcpRegistry } from '~~/server/utils/mcp-manager-service'

export default defineEventHandler(() => {
  return {
    success: true,
    data: mcpRegistry.getAllConfigs()
  }
})
