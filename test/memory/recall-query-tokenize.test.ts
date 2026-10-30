import { test } from 'node:test'
import assert from 'node:assert/strict'

import { tokenizeRecallQuery } from '../../server/utils/memory-service'

// 回归背景：召回 query 曾按整串 substring 匹配，"Grafeo 锁" 这类多词自然语言查询
// 因要求整串连续出现而必然落空（召回返回 0 条）。分词后任一词元命中即保留。

test('召回分词：中文多词查询拆分为独立词元', () => {
  const tokens = tokenizeRecallQuery('Grafeo 锁 挂起进程')
  assert.ok(tokens.includes('grafeo'), `应含 grafeo: ${tokens}`)
  assert.ok(tokens.includes('进程'), `应含 进程: ${tokens}`)
  // 原始分块保留：词典把「挂起进程」切成 挂|起|进程 时，整块仍作为词元可整串命中
  assert.ok(tokens.includes('挂起进程'), `应含原始分块 挂起进程: ${tokens}`)
})

test('召回分词：英文多词查询按空白拆分', () => {
  assert.deepEqual(tokenizeRecallQuery('nuxt sqlite'), ['nuxt', 'sqlite'])
})

test('召回分词：中英混合长句拆出多个有效词元', () => {
  const tokens = tokenizeRecallQuery('Nuxt UI 的 outline 变体白底坑')
  assert.ok(tokens.includes('nuxt'))
  assert.ok(tokens.includes('outline'))
  assert.ok(tokens.some(t => t.includes('白底')), `应含白底相关词: ${tokens}`)
})

test('召回分词：单字查询回退原始整串（保留旧语义）', () => {
  assert.deepEqual(tokenizeRecallQuery('锁'), ['锁'])
})

test('召回分词：空查询返回空数组（不过滤）', () => {
  assert.deepEqual(tokenizeRecallQuery('   '), [])
})
