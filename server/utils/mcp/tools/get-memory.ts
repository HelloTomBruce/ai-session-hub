import { mcpLogger } from '../../mcp-logger'
import { memoryService } from '../../memory-service'

import type { McpToolDefinition } from '../tool-types'

export const GetMemoryTool: McpToolDefinition = {
  name: 'get_memory',
  description: '按 id 获取记忆的完整内容：完整正文 (content)、代码片段 (snippets)、全部实体关联 (projects/techConcepts/problems) 及演进链 (SUPERSEDES)。通常先通过 recall_memories 召回拿到 id，再用此工具拉取详情。',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: '记忆节点的 id（来自 recall_memories 返回）'
      }
    },
    required: ['id']
  },
  async handler({ args, name, startTime }) {
    const id = (args.id as string) || ''

    if (!id) {
      mcpLogger.addLog({
        type: 'tool',
        name,
        params: args,
        status: 'error',
        durationMs: Date.now() - startTime,
        responsePreview: 'Missing required parameter: id'
      })
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: id' }) }],
        isError: true
      }
    }

    const memory = await memoryService.getMemory(id)

    if (!memory) {
      mcpLogger.addLog({
        type: 'tool',
        name,
        params: args,
        status: 'error',
        durationMs: Date.now() - startTime,
        responsePreview: `Memory not found: ${id}`
      })
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Memory not found: ${id}` }) }],
        isError: true
      }
    }

    mcpLogger.addLog({
      type: 'tool',
      name,
      params: args,
      status: 'success',
      durationMs: Date.now() - startTime,
      responsePreview: `Fetched memory: ${memory.title}`
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(memory, null, 2)
        }
      ]
    }
  }
}
