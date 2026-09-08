import { mcpRegistry } from '~~/server/utils/mcp-providers/mcp-provider-registry'

export default defineEventHandler(() => {
  return {
    success: true,
    data: mcpRegistry.getAllConfigs()
  }
})
