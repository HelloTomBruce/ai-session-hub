import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyEvidenceQuotes } from '../../server/utils/memory-extractor'

const SESSION = `
[USER] 开始智能提炼按钮样式有问题，现在看起来像是置灰的
[ASSISTANT] (thinking) 根因是 app.config.ts 中 primary 被配置为 zinc 灰色系
[ASSISTANT] Nuxt UI 的 solid primary 按钮渲染为 bg-zinc-500，与禁用态视觉无法区分
[ASSISTANT] 修复：跟随 distill.vue 的高对比写法，改为 bg-zinc-900 text-white
`

test('证据锚定：真实原句引用全部通过', () => {
  const quotes = [
    '根因是 app.config.ts 中 primary 被配置为 zinc 灰色系',
    '与禁用态视觉无法区分'
  ]
  const r = verifyEvidenceQuotes(quotes, SESSION)
  assert.deepEqual(r, { passed: 2, total: 2 })
})

test('证据锚定：编造的引文校验失败', () => {
  const quotes = ['这段话在会话里根本不存在，纯属 LLM 幻觉输出用于测试']
  const r = verifyEvidenceQuotes(quotes, SESSION)
  assert.deepEqual(r, { passed: 0, total: 1 })
})

test('证据锚定：LLM 截断长引文时头部匹配容错通过', () => {
  const quotes = ['根因是 app.config.ts 中 primary 被配置为 zinc 灰色系。之后我们改了很多东西补充说明……']
  const r = verifyEvidenceQuotes(quotes, SESSION)
  assert.deepEqual(r, { passed: 1, total: 1 })
})

test('证据锚定：空白归一化差异（换行/多空格）不影响匹配', () => {
  const quotes = ['根因是  app.config.ts\t中 primary\n被配置为 zinc 灰色系']
  const r = verifyEvidenceQuotes(quotes, SESSION)
  assert.deepEqual(r, { passed: 1, total: 1 })
})

test('证据锚定：空引文被忽略不计入总数', () => {
  const r = verifyEvidenceQuotes(['   ', '与禁用态视觉无法区分'], SESSION)
  assert.deepEqual(r, { passed: 1, total: 1 })
})
