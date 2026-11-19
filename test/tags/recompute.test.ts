import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

const TEST_HOME = path.resolve('.test-hub', `tags-${Date.now()}`)
process.env.HUB_HOME = TEST_HOME

const { getHubDb } = await import('../../server/utils/db')
const { tagService } = await import('../../server/utils/tag-service')

const ALL_AUTO = ['bugfix', 'refactor', 'feature', 'deploy', 'migration', 'documentation', 'performance', 'security', 'testing']

function seed(sessionId: string, title: string, tags: string[], firstUserMessage: string) {
  const db = getHubDb()!
  const now = Date.now()
  db.prepare(`INSERT OR REPLACE INTO sessions_cache (id, platform, title, cwd, message_count, created_at, updated_at, tags)
    VALUES (?, 'dsh', ?, '/tmp/x', 3, ?, ?, ?)`).run(sessionId, title, now, now, JSON.stringify(tags))
  db.prepare(`INSERT OR REPLACE INTO messages_cache (id, session_id, platform, role, content, timestamp)
    VALUES (?, ?, 'dsh', 'user', ?, ?)`).run(`${sessionId}-m1`, sessionId, firstUserMessage, now)
}

test('重算清洗历史污染：9 个标签收敛，手工标签保留', () => {
  seed('s-polluted', '了解一下 packages 里的 llm 包', ALL_AUTO, '帮我 address 一下 issue，update 依赖，test 跑不通')
  seed('s-real-bug', '修复登录弹窗崩溃', ALL_AUTO, '线上登录弹窗一打开就白屏')

  const result = tagService.recomputeAllSessionTags(100)
  assert.equal(result.total >= 2, true)
  assert.equal(result.errors, 0)

  const polluted = tagService.getSessionTags('s-polluted', 'dsh')
  assert.ok(polluted.length <= 3, `污染会话的标签应收敛，实际 ${JSON.stringify(polluted)}`)
  assert.ok(!(polluted.length === 9), '不应继续保留 9 个全量标签')

  const bug = tagService.getSessionTags('s-real-bug', 'dsh')
  assert.ok(bug.includes('bugfix'), `真实 bugfix 会话应保留 bugfix，实际 ${JSON.stringify(bug)}`)
})

test('重算保留用户手工标签', () => {
  const db = getHubDb()!
  const now = Date.now()
  db.prepare(`INSERT OR REPLACE INTO sessions_cache (id, platform, title, cwd, message_count, created_at, updated_at, tags)
    VALUES ('s-manual', 'dsh', '随便聊聊', '/tmp/x', 3, ?, ?, ?)`).run(now, now, JSON.stringify([...ALL_AUTO, '迭代']))

  tagService.recomputeAllSessionTags(100)
  const tags = tagService.getSessionTags('s-manual', 'dsh')
  assert.ok(tags.includes('迭代'), `手工标签应保留，实际 ${JSON.stringify(tags)}`)
  assert.ok(!tags.includes('security'), '未被证实的自动标签应被清除')
})

test('重算幂等：第二次运行不再产生变化', () => {
  const first = tagService.recomputeAllSessionTags(100)
  const second = tagService.recomputeAllSessionTags(100)
  assert.equal(second.changed, 0, `第二次不应有变更，实际 ${second.changed}`)
  assert.equal(first.errors + second.errors, 0)
})
