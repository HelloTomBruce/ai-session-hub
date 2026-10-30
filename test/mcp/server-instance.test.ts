import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { createMcpServer } from '../../server/utils/mcp-server-instance'
import { MCP_AUTONOMY_PROTOCOL } from '../../server/utils/mcp/instructions'
import { mcpTools } from '../../server/utils/mcp/tools'

/**
 * 集成测试：真实 Server 实例经 InMemoryTransport 握手，
 * 验证自主使用协议随 initialize 下发、工具清单完整。
 */
async function connectTestClient() {
  const server = createMcpServer()
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return { server, client }
}

test('MCP 握手：自主使用协议随 initialize.instructions 下发', async () => {
  const { client } = await connectTestClient()
  assert.equal(client.getInstructions(), MCP_AUTONOMY_PROTOCOL)
})

test('协议内容：覆盖记忆闭环的关键工具与安全围栏规则', () => {
  const required = [
    'recall_memories',
    'get_memory',
    'search_sessions_fts',
    'get_session_details',
    'rate_memory',
    'save_memory',
    'BEGIN STORED MEMORY',
    'END STORED MEMORY'
  ]
  for (const keyword of required) {
    assert.ok(MCP_AUTONOMY_PROTOCOL.includes(keyword), `协议应提及: ${keyword}`)
  }
  // 全文进入宿主系统提示词，需控制长度
  assert.ok(MCP_AUTONOMY_PROTOCOL.length < 1200, '协议应保持精简')
})

test('MCP 握手：工具清单完整且召回类工具声明围栏', async () => {
  const { client } = await connectTestClient()
  const { tools } = await client.listTools()
  assert.equal(tools.length, mcpTools.length)

  const fenced = new Set(mcpTools.filter(t => t.wrapsUntrusted).map(t => t.name))
  assert.deepEqual(
    [...fenced].sort(),
    [
      'get_memory',
      'get_project_adrs',
      'get_session_details',
      'recall_memories',
      'search_knowledge_vault',
      'search_memory_graph',
      'search_sessions_fts'
    ],
    '召回/检索类工具应全部声明 wrapsUntrusted'
  )
})
