import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEvidence } from '@session-hub/analyzer'
import { CONTRACT_PATCH, contractSession } from '../fixtures/sessions'

test('claude apply_patch 能解析出改动文件与契约内容', () => {
  const ev = normalizeEvidence(contractSession('claude'))
  assert.equal(ev.changedFiles.length, 1)
  assert.equal(ev.changedFiles[0].path, 'server/utils/billing-service.ts')
  assert.equal(ev.changedFiles[0].hasContent, true)
  assert.match(ev.patchText, /export interface BillingOptions/)
  assert.equal(ev.metrics.editWriteCount, 1)
})

test('codex update_file 与 pi write_file 归一化结果一致', () => {
  const codex = normalizeEvidence(contractSession('codex'))
  const pi = normalizeEvidence(contractSession('pi'))
  assert.equal(codex.changedFiles[0].path, pi.changedFiles[0].path)
  assert.equal(codex.metrics.editWriteCount, 1)
  assert.equal(pi.metrics.editWriteCount, 1)
  assert.match(codex.patchText, /export interface BillingOptions/)
})

test('Bash 重定向写盘可被识别，纯执行命令不臆造文件', () => {
  const ev = normalizeEvidence({
    sessionId: 't1',
    platform: 'claude',
    title: 'shell writes',
    messages: [
      { role: 'user', content: '写文件并跑测试' },
      {
        role: 'assistant',
        content: 'ok',
        toolCalls: [
          { name: 'Bash', arguments: { command: 'echo hi > /tmp/x/out.txt' } },
          { name: 'Bash', arguments: { command: 'pnpm test' } }
        ]
      }
    ]
  })
  assert.deepEqual(ev.changedFiles.map(f => f.path), ['/tmp/x/out.txt'])
  assert.equal(ev.metrics.editWriteCount, 1)
})

test('锁文件与构建产物不计入改动文件', () => {
  const ev = normalizeEvidence({
    sessionId: 't2',
    platform: 'claude',
    title: 'lockfile',
    messages: [
      { role: 'user', content: '升级依赖' },
      {
        role: 'assistant',
        content: 'done',
        toolCalls: [
          { name: 'apply_patch', input: `*** Begin Patch\n*** Update File: pnpm-lock.yaml\n@@\n+new lock line\n*** End Patch` },
          { name: 'apply_patch', input: `*** Begin Patch\n*** Update File: package.json\n+  "x": "1"\n*** End Patch` }
        ]
      }
    ]
  })
  assert.deepEqual(ev.changedFiles.map(f => f.path), ['package.json'])
})

test('CONTRACT_PATCH fixture 自检', () => {
  assert.match(CONTRACT_PATCH, /^\*\*\* Begin Patch/)
})

test('回归：heredoc 正文中的 markdown "> 行"不被误判为重定向写盘目标', () => {
  const ev = normalizeEvidence({
    sessionId: 't-heredoc',
    platform: 'codex',
    title: 'heredoc write',
    messages: [
      { role: 'user', content: '写设计文档' },
      {
        role: 'assistant',
        content: 'done',
        toolCalls: [
          {
            name: 'exec_command',
            type: 'function_call',
            arguments: {
              cmd: 'cat > docs/design.md <<\'EOF\'\n# 设计文档\n> 版本：v1.0\n> 作者：AI-assisted\n正常内容一行\nEOF'
            }
          }
        ]
      }
    ]
  })
  assert.equal(ev.changedFiles.length, 1)
  assert.equal(ev.changedFiles[0].path, 'docs/design.md')
})

test('回归：codex function_call 工具流（exec_command 重定向写盘）被归一化识别', () => {
  const ev = normalizeEvidence({
    sessionId: 't-fncall',
    platform: 'codex',
    title: 'function_call session',
    messages: [
      { role: 'user', content: '修复 bug' },
      {
        role: 'assistant',
        content: 'ok',
        toolCalls: [
          { name: 'exec_command', type: 'function_call', arguments: { cmd: 'grep -rn "apply_patch" server/utils 2>/dev/null' } },
          { name: 'exec_command', type: 'function_call', arguments: { cmd: 'cd /repo && cat > server/utils/fix.ts <<\'EOF\'\nexport const fix = 1\nEOF' } }
        ]
      }
    ]
  })
  assert.equal(ev.metrics.toolCallCount, 2)
  assert.equal(ev.metrics.editWriteCount, 1)
  assert.deepEqual(ev.changedFiles.map(f => f.path), ['server/utils/fix.ts'])
})
