import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTitleForDedup, contentSimilarity } from '../../server/utils/harvest-dedup'
import { buildMessagesContent } from '../../server/utils/memory-extractor'
import type { SessionMessage } from '../../server/utils/types'

test('标题规范化：大小写与空白折叠', () => {
  assert.equal(
    normalizeTitleForDedup('  SSE   单例 泄漏修复 '),
    'sse 单例 泄漏修复'
  )
})

test('内容相似度：实质一致 >=0.8，演进内容更低', () => {
  const a = ['决策背景：连接未关闭导致重复', '决策内容：dispose 时统一 close', '后果：重连不再叠加'].join('\n')
  const same = ['决策背景：连接未关闭导致重复', '决策内容：dispose 时统一 close', '后果：重连不再叠加', '补充一句新话'].join('\n')
  const evolved = ['全新的背景描述与上一版不同结构', '采用注册表管理多个连接实例', '引入引用计数与生命周期管理', '废弃旧的单例守卫模式'].join('\n')
  assert.ok(contentSimilarity(a, same) >= 0.8, contentSimilarity(a, same).toFixed(2))
  assert.ok(contentSimilarity(a, evolved) < 0.5, contentSimilarity(a, evolved).toFixed(2))
  assert.equal(contentSimilarity('', a), 0)
})

test('内容相似度：短内容回退 3-gram 判定，相同/不同可区分', () => {
  const short = '升级前先备份'
  assert.equal(contentSimilarity(short, '升级前先备份'), 1)
  // 标点/空白变体应判定为实质一致（修复前短内容行过滤后恒为 0，必走 superseded）
  assert.ok(contentSimilarity(short, '  升级前先备份。 ') >= 0.8, contentSimilarity(short, '  升级前先备份。 ').toFixed(2))
  assert.ok(contentSimilarity(short, '先编译再提交') < 0.5, contentSimilarity(short, '先编译再提交').toFixed(2))
  assert.equal(contentSimilarity('', short), 0)
})

test('内容相似度：混合长短内容按 shingle 判定，长内容仍走行级', () => {
  const long = ['决策背景：连接未关闭导致重复', '决策内容：dispose 时统一 close', '后果：重连不再叠加'].join('\n')
  assert.ok(contentSimilarity(long, '升级前先备份') < 0.5)
})

test('抽取上下文构造：含 thought/工具参数且超长截断', () => {
  const messages: SessionMessage[] = [
    { role: 'user', content: '排查 SSE 重复' },
    {
      role: 'assistant',
      content: '根因是未关闭',
      thought: '根本原因在于单例泄漏',
      toolCalls: [{ name: 'apply_patch', arguments: { input: '*** Begin Patch' } }]
    },
    {
      role: 'user',
      content: 'x'.repeat(20000)
    }
  ]
  const out = buildMessagesContent(messages)
  assert.match(out, /\(thinking\)/)
  assert.match(out, /tool:apply_patch/)
  assert.ok(out.length <= 16500, `len=${out.length}`)
})
