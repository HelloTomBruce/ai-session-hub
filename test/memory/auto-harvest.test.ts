import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
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

test('isCandidateForHarvest: 纯对话无工具跳过', () => {
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
  assert.match(check.reason || '', /未检测到实质工具执行/)
})

test('isCandidateForHarvest: 普通业务增改无报错跳过', () => {
  const session: UnifiedSession = {
    id: 'test-routine',
    cli: 'claude',
    category: 'cli',
    title: '首页增加一个文案标签',
    cwd: '/tmp',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rawLocation: ''
  }
  const messages: SessionMessage[] = [
    { role: 'user', content: '在 Header 加个欢迎文案' },
    {
      role: 'assistant',
      content: '修改 Header.vue',
      toolCalls: [{ name: 'edit_file', arguments: { path: 'Header.vue' } }]
    },
    { role: 'user', content: '好的搞定了' }
  ]
  const check = autoHarvestService.isCandidateForHarvest(session, messages)
  assert.equal(check.pass, false)
  assert.match(check.reason || '', /日常业务增改，无需沉淀/)
})

test('isCandidateForHarvest: 包含报错排查或排障标题通过筛选', () => {
  const session: UnifiedSession = {
    id: 'test-3',
    cli: 'claude',
    category: 'cli',
    title: '修复 SQLite 锁死报错',
    cwd: '/tmp/project',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rawLocation: ''
  }
  const messages: SessionMessage[] = [
    { role: 'user', content: '运行测试报错 database is locked' },
    {
      role: 'assistant',
      content: '让我看下代码并在 config 里修复',
      toolCalls: [{ name: 'edit_file', arguments: { path: 'db.ts' } }]
    },
    { role: 'user', content: '好了，测试通过！' }
  ]
  const check = autoHarvestService.isCandidateForHarvest(session, messages)
  assert.equal(check.pass, true)
})

test('isCandidateForHarvest: 触碰核心基建配置通过筛选', () => {
  const session: UnifiedSession = {
    id: 'test-config',
    cli: 'pi',
    category: 'cli',
    title: '升级项目依赖',
    cwd: '/tmp/project',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rawLocation: ''
  }
  const messages: SessionMessage[] = [
    { role: 'user', content: '升级 package.json 依赖' },
    {
      role: 'assistant',
      content: '修改 package.json',
      toolCalls: [{ name: 'edit_file', arguments: { path: 'package.json' } }]
    },
    { role: 'user', content: '升级成功' }
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
