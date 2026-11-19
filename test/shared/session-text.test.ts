import test from 'node:test'
import assert from 'node:assert/strict'
import {
  stripInjectedContent,
  looksLikeInjectedContent,
  firstRealUserMessage
} from '../../shared/utils/session-text'

test('stripInjectedContent：剥离成对注入块并保留正文', () => {
  const raw = '<system-reminder>你好</system-reminder>把登录弹窗修一下'
  assert.equal(stripInjectedContent(raw), '把登录弹窗修一下')
})

test('stripInjectedContent：整条都是平台注入时返回空串', () => {
  const env = '# Environment\nYou are powered by k3\nAvailable agent types: ...'
  assert.equal(stripInjectedContent(env), '')
  assert.equal(stripInjectedContent('You are powered by k3'), '')
  assert.equal(stripInjectedContent('Today\'s date is 2026-11-19'), '')
})

test('stripInjectedContent：普通用户输入原样保留（含前后空白裁剪）', () => {
  assert.equal(stripInjectedContent('  看下这个报错  '), '看下这个报错')
  assert.equal(stripInjectedContent(''), '')
})

test('looksLikeInjectedContent：识别注入但放行正常文本', () => {
  assert.equal(looksLikeInjectedContent('<env>{"cwd":"/tmp"}</env>'), true)
  assert.equal(looksLikeInjectedContent('# Environment\n...'), true)
  assert.equal(looksLikeInjectedContent('帮我重构这段代码'), false)
  assert.equal(looksLikeInjectedContent('<div>这不是注入，是用户贴的 HTML</div>'), true)
})

test('firstRealUserMessage：跳过注入消息，取第一条真实输入', () => {
  const messages = [
    { role: 'user', content: '<system-reminder>ctx</system-reminder># Environment\nfoo' },
    { role: 'assistant', content: '收到' },
    { role: 'user', content: '把首页卡片改成三列' }
  ]
  assert.equal(firstRealUserMessage(messages), '把首页卡片改成三列')
})

test('firstRealUserMessage：全是注入时回退第一条用户消息', () => {
  const messages = [
    { role: 'user', content: '# Environment\nfoo' }
  ]
  assert.equal(firstRealUserMessage(messages), '# Environment\nfoo')
})

test('firstRealUserMessage：尊重 limit 与 maxLength', () => {
  const messages = [
    { role: 'user', content: 'x'.repeat(100) },
    { role: 'user', content: '第二条' }
  ]
  assert.equal(firstRealUserMessage(messages, { limit: 0 }), '')
  assert.equal(firstRealUserMessage(messages, { maxLength: 10 }).length, 10)
})
