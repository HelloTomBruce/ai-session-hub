import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { DshPlugin } from '../../packages/plugin-dsh/src/index'

const hasZstd = typeof (zlib as { zstdCompressSync?: unknown }).zstdCompressSync === 'function'

function compress(jsonl: string): Buffer {
  const api = zlib as unknown as { zstdCompressSync: (buf: Buffer) => Buffer }
  return api.zstdCompressSync(Buffer.from(jsonl, 'utf-8'))
}

function toLines(events: unknown[]): string {
  // 与真实 dsh 日志一致：每帧末尾带换行，多帧拼接后仍是逐行 JSONL
  return `${events.map(event => JSON.stringify(event)).join('\n')}\n`
}

function makeSessionsDir(files: Record<string, string | Buffer>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-test-'))
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return dir
}

const V4_SESSION_ID = 'session-aaa11111-2222-3333-4444-555555555555'

const v4Events = [
  { type: 'session', version: 4, id: V4_SESSION_ID, createdAt: 1791879478922, cwd: '/tmp/proj', origin: 'subagent', parentSession: 'parent-1', agentPreset: 'standard', delegationDepth: 1 },
  { type: 'system/message', seq: 1, time: 1791879478930, data: { turn: 1, step: 1, message: { role: 'system', content: [{ type: 'text', text: 'You are an AI agent powered by DeepSeek Harness.' }] } } },
  { type: 'user/message', seq: 2, time: 1791879478980, data: { content: [{ type: 'text', text: '重构这个组件' }], source: { kind: 'user' }, role: 'user', id: 'u1' } },
  { type: 'user/message', seq: 3, time: 1791879478990, data: { content: [{ type: 'text', text: 'runtime snapshot injection' }], source: { kind: 'runtime-context' }, role: 'user', id: 'u2' } },
  { type: 'session/title', seq: 4, time: 1791879479000, data: { title: '重构组件', source: { kind: 'fallback' } } },
  { type: 'request/header', seq: 5, time: 1791879479010, data: { header: { config: { provider: 'kimi-coding', model: 'k3', maxTokens: 131072 } } } },
  { type: 'turn/start', seq: 6, time: 1791879479020, data: { turn: 1 } },
  {
    type: 'assistant/message',
    seq: 7,
    time: 1791879496332,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Look at the files first.' },
          { type: 'text', text: '我先读取文件' },
          { type: 'tool-call', id: 'tool_abc', name: 'read', arguments: '{"file_path":"/tmp/proj/a.ts"}' }
        ]
      }
    }
  },
  { type: 'tool/call', seq: 8, time: 1791879496333, data: { turn: 1, step: 1, callId: 'tool_abc', name: 'read', arguments: '{"file_path":"/tmp/proj/a.ts"}' } },
  { type: 'tool/result', seq: 9, time: 1791879496373, data: { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId: 'tool_abc' }, toolCallId: 'tool_abc', content: [{ type: 'text', text: 'file content here' }] } } },
  { type: 'turn/end', seq: 10, time: 1791879692302, data: { turn: 1, reason: { kind: 'completed' } } }
]

const v2SessionId = 'vvv22222-3333-4444-5555-666666666666'

const v2Events = [
  { type: 'session', version: 2, id: v2SessionId, createdAt: 1788852629612, cwd: '/tmp/legacy', agentPreset: 'standard' },
  { type: 'user/message', seq: 1, time: 1788852629700, data: { content: [{ type: 'text', text: '旧版会话提问' }], source: { kind: 'user' }, role: 'user', id: 'v2u1' } },
  {
    type: 'assistant/message',
    seq: 2,
    time: 1788852629800,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          { type: 'tool-call', id: 'tool_v2', name: 'bash', arguments: '{"command":"ls"}' }
        ]
      }
    }
  },
  { type: 'tool/result', seq: 3, time: 1788852629900, data: { turn: 1, step: 1, message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'tool_v2', content: [{ type: 'text', text: 'a.ts\nb.ts' }], isError: false }] } } }
]

test('getSessions 汇总 v4 会话并优先选择最新版本日志', { skip: !hasZstd }, () => {
  const dir = makeSessionsDir({
    '--tmp-proj--/session-aaa11111-2222-3333-4444-555555555555/session.v4.jsonl.zstd': compress(toLines(v4Events)),
    '--tmp-proj--/session-aaa11111-2222-3333-4444-555555555555/session.jsonl.zstd': compress(toLines([{ type: 'session', version: 0, id: V4_SESSION_ID, createdAt: 1 }])),
    '--tmp-proj--/session-aaa11111-2222-3333-4444-555555555555/session.lock': Buffer.from(''),
    '--tmp-proj--/not-a-session/notes.txt': Buffer.from('ignore me')
  })
  const plugin = new DshPlugin(dir)

  assert.equal(plugin.isAvailable(), true)
  const sessions = plugin.getSessions()
  assert.equal(sessions.length, 1)

  const s = sessions[0]
  assert.equal(s.cli, 'dsh')
  assert.equal(s.category, 'cli')
  assert.equal(s.title, '重构组件')
  assert.equal(s.cwd, '/tmp/proj')
  assert.equal(s.model, 'k3')
  assert.equal(s.messageCount, 2) // 1 user + 1 assistant（注入消息不计）
  assert.equal(s.extra?.log_version, 4)
  assert.equal(s.extra?.provider, 'kimi-coding')
  assert.equal(s.extra?.origin, 'subagent')
  assert.equal(s.extra?.parent_session, 'parent-1')
  assert.equal(s.updatedAt, 1791879692302)
})

test('getSessions 标题缺失时回退首条用户消息', { skip: !hasZstd }, () => {
  const dir = makeSessionsDir({
    '--tmp-legacy--/vvv22222-3333-4444-5555-666666666666/session.v2.jsonl.zstd': compress(toLines(v2Events))
  })
  const plugin = new DshPlugin(dir)
  const sessions = plugin.getSessions()

  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].title, '旧版会话提问')
})

test('getMessages 解析 v4：真人消息、思维链、工具调用与结果关联', { skip: !hasZstd }, () => {
  const dir = makeSessionsDir({
    '--tmp-proj--/session-aaa11111-2222-3333-4444-555555555555/session.v4.jsonl.zstd': compress(toLines(v4Events))
  })
  const plugin = new DshPlugin(dir)
  const messages = plugin.getMessages(V4_SESSION_ID)

  // system + 1 真人 user + 1 assistant（runtime-context 注入被过滤）
  assert.equal(messages.length, 3)
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[1].role, 'user')
  assert.equal(messages[1].content, '重构这个组件')

  const assistant = messages[2]
  assert.equal(assistant.role, 'assistant')
  assert.equal(assistant.content, '我先读取文件')
  assert.equal(assistant.thought, 'Look at the files first.')
  assert.ok(assistant.toolCalls)
  assert.equal(assistant.toolCalls!.length, 1)
  const call = assistant.toolCalls![0]
  assert.equal(call.name, 'read')
  assert.deepEqual(call.arguments, { file_path: '/tmp/proj/a.ts' })
  assert.equal(call.output, 'file content here')
})

test('getMessages 解析 v2 旧结构 tool-result', { skip: !hasZstd }, () => {
  const dir = makeSessionsDir({
    '--tmp-legacy--/vvv22222-3333-4444-5555-666666666666/session.v2.jsonl.zstd': compress(toLines(v2Events))
  })
  const plugin = new DshPlugin(dir)
  const messages = plugin.getMessages(v2SessionId)

  assert.equal(messages.length, 2)
  const assistant = messages[1]
  assert.ok(assistant.toolCalls)
  assert.equal(assistant.toolCalls![0].name, 'bash')
  assert.equal(assistant.toolCalls![0].output, 'a.ts\nb.ts')
})

test('目录名带 session- 前缀时可用裸 UUID 定位', { skip: !hasZstd }, () => {
  const dir = makeSessionsDir({
    '--tmp-proj--/session-aaa11111-2222-3333-4444-555555555555/session.v4.jsonl.zstd': compress(toLines(v4Events))
  })
  const plugin = new DshPlugin(dir)
  const messages = plugin.getMessages('aaa11111-2222-3333-4444-555555555555')
  assert.equal(messages.length, 3)
})

test('多帧拼接的 zstd 日志可完整解析（dsh 追加式逐帧写入）', { skip: !hasZstd }, () => {
  const firstChunk = compress(toLines([
    { type: 'session', version: 4, id: 'multi-0000-1111', createdAt: 100, cwd: '/tmp/multi' }
  ]))
  const secondChunk = compress(toLines([
    { type: 'user/message', seq: 1, time: 200, data: { content: [{ type: 'text', text: '第二帧里的消息' }], source: { kind: 'user' }, role: 'user', id: 'm1' } }
  ]))
  const dir = makeSessionsDir({
    '--tmp-multi--/multi-0000-1111/session.v4.jsonl.zstd': Buffer.concat([firstChunk, secondChunk])
  })
  const plugin = new DshPlugin(dir)
  const sessions = plugin.getSessions()
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].title, '第二帧里的消息')
})

test('目录不存在时返回空列表', () => {
  const plugin = new DshPlugin('/nonexistent/dsh-sessions')
  assert.equal(plugin.isAvailable(), false)
  assert.deepEqual(plugin.getSessions(), [])
  assert.deepEqual(plugin.getMessages('whatever'), [])
})

test('deleteSession 删除整个会话目录（含多版本日志）', { skip: !hasZstd }, () => {
  const sessionDir = `--tmp-proj--/${V4_SESSION_ID}`
  const dir = makeSessionsDir({
    [`${sessionDir}/session.v4.jsonl.zstd`]: compress(toLines(v4Events)),
    [`${sessionDir}/session.jsonl.zstd`]: compress(toLines([{ type: 'session', version: 0, id: V4_SESSION_ID, createdAt: 1 }])),
    [`${sessionDir}/session.lock`]: Buffer.from(''),
    '--tmp-proj--/other-session/session.v2.jsonl.zstd': compress(toLines(v2Events.map(e => ({ ...e, id: 'other' }))))
  })
  const plugin = new DshPlugin(dir)
  assert.equal(plugin.getSessions().length, 2)

  assert.equal(plugin.deleteSession(V4_SESSION_ID), true)
  assert.equal(fs.existsSync(path.join(dir, sessionDir)), false)

  // 删除后重新扫描列表不再出现，其他会话不受影响
  const remaining = plugin.getSessions()
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].id, 'other')

  // 重复删除幂等
  assert.equal(plugin.deleteSession(V4_SESSION_ID), true)
})

test('deleteSession 支持裸 UUID 定位带 session- 前缀的目录', { skip: !hasZstd }, () => {
  const sessionDir = `--tmp-proj--/${V4_SESSION_ID}`
  const dir = makeSessionsDir({
    [`${sessionDir}/session.v4.jsonl.zstd`]: compress(toLines(v4Events))
  })
  const plugin = new DshPlugin(dir)

  assert.equal(plugin.deleteSession('aaa11111-2222-3333-4444-555555555555'), true)
  assert.equal(fs.existsSync(path.join(dir, sessionDir)), false)
  assert.deepEqual(plugin.getSessions(), [])
})
