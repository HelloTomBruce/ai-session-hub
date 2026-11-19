import test from 'node:test'
import assert from 'node:assert/strict'
import { tagService, __tagInternals } from '../../server/utils/tag-service'

const { matchesPattern } = __tagInternals

/**
 * 回归背景：旧实现用 `allText.includes(pattern)` 匹配整段会话，
 * 导致 172/224 个会话被打上完全相同的 9 个标签。以下用例锁死新语义。
 */

test('词边界：泛词不应命中更长单词的前缀', () => {
  assert.equal(matchesPattern('address already in use', 'add'), false)
  assert.equal(matchesPattern('prefix handling logic', 'fix'), false)
  assert.equal(matchesPattern('updated dependency', 'update'), false)
  assert.equal(matchesPattern('contest result', 'test'), false)
})

test('词边界：独立单词仍正常命中', () => {
  assert.equal(matchesPattern('fix login bug', 'fix'), true)
  assert.equal(matchesPattern('add index for query', 'add'), true)
  assert.equal(matchesPattern('run test suite', 'test'), true)
})

test('中文按子串匹配（中文无词边界）', () => {
  assert.equal(matchesPattern('修复登录弹窗崩溃', '修复'), true)
  assert.equal(matchesPattern('把会话列表重构一下', '重构'), true)
  assert.equal(matchesPattern('今天天气不错', '修复'), false)
})

test('标题信号：明确的修复类标题命中 bugfix', () => {
  const tags = tagService.autoDetectTags('修复登录弹窗崩溃', [])
  assert.ok(tags.includes('bugfix'), `期望包含 bugfix，实际 ${JSON.stringify(tags)}`)
})

test('旧病态输入：正文里塞满泛词也不应一次打满 9 个标签', () => {
  // 模拟一段普通长会话：正文里出现 add / update / test / doc / performance / cache 等泛词
  const body = [
    '帮我 address 一下这个 issue，之前 update 过依赖，test 跑不通，',
    'doc 里写着 performance 相关说明，cache 也要 lazy load，',
    '顺便 fix 一下 prefix 的 bug，release 流程再看下'
  ].join('')
  const tags = tagService.autoDetectTags('了解一下 packages 里的 llm 包', [{ role: 'user', content: body }])
  assert.ok(tags.length <= 1, `泛词不应叠加出多个标签，实际 ${JSON.stringify(tags)}`)
})

test('最多产出 3 个自动标签', () => {
  const tags = tagService.autoDetectTags('修复重构部署迁移文档性能安全测试全都有', [])
  assert.ok(tags.length <= 3, `应当被截断到 3 个，实际 ${JSON.stringify(tags)}`)
})

test('无信号标题不产生标签', () => {
  assert.deepEqual(tagService.autoDetectTags('今天聊点什么', [{ role: 'user', content: '随便聊聊' }]), [])
})
