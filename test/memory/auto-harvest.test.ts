import test from 'node:test'
import assert from 'node:assert/strict'
import { autoHarvestService } from '../../server/utils/auto-harvest'
import type { UnifiedSession, SessionMessage } from '../../server/utils/types'

test('isCandidateForHarvest: 消息过少直接跳过', () => {
  const session: UnifiedSession = {
    id: 'test-1',
    cli: 'pi',
    category: 'cli',
    title: 'Test',
    cwd: '/tmp',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rawLocation: ''
  }
  const messages: SessionMessage[] = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' }
  ]
  const check = autoHarvestService.isCandidateForHarvest(session, messages)
  assert.equal(check.pass, false)
  assert.match(check.reason || '', /少于 3 条/)
})

test('isCandidateForHarvest: 纯问答无工具与代码跳过', () => {
  const session: UnifiedSession = {
    id: 'test-2',
    cli: 'pi',
    category: 'cli',
    title: 'Test Q&A',
    cwd: '/tmp',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rawLocation: ''
  }
  const messages: SessionMessage[] = [
    { role: 'user', content: '什么是 Nuxt 3?' },
    { role: 'assistant', content: 'Nuxt 3 是一个全栈框架。' },
    { role: 'user', content: '好的谢谢。' }
  ]
  const check = autoHarvestService.isCandidateForHarvest(session, messages)
  assert.equal(check.pass, false)
  assert.match(check.reason || '', /低密度对话/)
})

test('isCandidateForHarvest: 包含工具调用通过候选筛选', () => {
  const session: UnifiedSession = {
    id: 'test-3',
    cli: 'claude',
    category: 'cli',
    title: 'Fix SQLite Lock Issue',
    cwd: '/tmp/project',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rawLocation: ''
  }
  const messages: SessionMessage[] = [
    { role: 'user', content: '修复 SQLite 锁报错' },
    {
      role: 'assistant',
      content: '让我看下代码',
      toolCalls: [{ name: 'edit_file', arguments: { path: 'db.ts' } }]
    },
    { role: 'user', content: '好了，测试通过！' }
  ]
  const check = autoHarvestService.isCandidateForHarvest(session, messages)
  assert.equal(check.pass, true)
})

test('autoHarvestService.getHarvestStats 结构完整', () => {
  const stats = autoHarvestService.getHarvestStats()
  assert.equal(typeof stats.totalSessions, 'number')
  assert.equal(typeof stats.harvestedCount, 'number')
  assert.equal(typeof stats.pendingCount, 'number')
  assert.equal(Array.isArray(stats.recentHarvests), true)
})
