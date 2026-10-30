import { test } from 'node:test'
import assert from 'node:assert/strict'

import { findSecretIn, secretRefusal } from '../../server/utils/mcp/secret-guard'

test('密钥守卫：识别各形态密钥', () => {
  const cases: [string, string][] = [
    [`export OPENAI_KEY=sk-proj-${'a'.repeat(40)}`, 'OpenAI/Anthropic API Key'],
    [`sk-${'Ab1'.repeat(15)}`, 'OpenAI/Anthropic API Key'],
    [`ghp_${'a'.repeat(36)}`, 'GitHub Token'],
    [`github_pat_${'a1_'.repeat(10)}`, 'GitHub Fine-grained Token'],
    [`glpat-${'a'.repeat(20)}`, 'GitLab Token'],
    [`AKIA${'A1'.repeat(8)}`, 'AWS Access Key ID'],
    [`xoxb-${'a'.repeat(15)}-b`, 'Slack Token'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----', 'Private Key'],
    ['-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk...', 'Private Key'],
    [`eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.${'S'.repeat(20)}`, 'JWT']
  ]
  for (const [text, kind] of cases) {
    assert.equal(findSecretIn([text])?.kind, kind, `应识别: ${text.slice(0, 20)}…`)
  }
})

test('密钥守卫：多段文本按顺序检查，null/undefined 跳过', () => {
  assert.equal(findSecretIn([null, undefined, '', '正常内容']), null)
  assert.equal(findSecretIn(['正常内容', `ghp_${'b'.repeat(36)}`])?.kind, 'GitHub Token')
})

test('密钥守卫：正常工程内容不误报', () => {
  const benign = [
    'const key = process.env.GITHUB_TOKEN',
    `fetch('https://api.example.com?signature=abc123def456')`,
    'sk-woocommerce-handler', // 短横线标识符，长度不足密钥阈值
    'AKIA 是 AWS Access Key ID 的前缀说明文字',
    'eyJ 开头的 base64 字符串单独出现不构成 JWT',
    '## Nuxt UI outline 变体的白底坑\n浅色背景上按钮呈现突兀白底，应改用 subtle 变体'
  ]
  for (const text of benign) {
    assert.equal(findSecretIn([text]), null, `不应误报: ${text.slice(0, 30)}`)
  }
})

test('密钥守卫：拒绝文案含类型与脱敏前缀，不回显完整密钥', () => {
  const finding = findSecretIn([`ghp_${'a'.repeat(36)}`])
  assert.ok(finding)
  const msg = secretRefusal(finding)
  assert.ok(msg.includes('GitHub Token'))
  assert.ok(msg.includes('拒绝写入'))
  assert.ok(!msg.includes('a'.repeat(36)), '文案不得回显完整密钥')
})
