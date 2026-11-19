import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// 必须在首次取连接前设置：测试只写仓库内临时目录，绝不碰用户真实 ~/.session-hub
const TEST_HOME = path.resolve('.test-hub', `provider-${Date.now()}`)
process.env.HUB_HOME = TEST_HOME

const { getHubDb, openHubDb, hubHome, hubFile, closeAllHubDb, hubDbConnectionCount } = await import('../../server/utils/db')

test('HUB_HOME 覆盖数据目录', () => {
  assert.equal(hubHome(), TEST_HOME)
  assert.equal(hubFile('x.db'), path.join(TEST_HOME, 'x.db'))
})

test('首次取连接时自动建表并写入 schema 版本', () => {
  const db = getHubDb()
  assert.ok(db, '连接应可用')
  const tables = (db!.prepare('SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY name').all() as Array<{ name: string }>).map(r => r.name)
  for (const expected of ['meta', 'sessions_cache', 'messages_cache', 'fts_messages', 'tag_defs', 'session_diagnoses', 'deleted_sessions']) {
    assert.ok(tables.includes(expected), `缺少表 ${expected}`)
  }
  const version = (db!.prepare('SELECT value FROM meta WHERE key = \'schema_version\'').get() as { value: string }).value
  assert.equal(version, '10')
})

test('同一文件只建立一条连接（缓存复用）', () => {
  getHubDb()
  const first = hubDbConnectionCount()
  getHubDb()
  assert.equal(hubDbConnectionCount(), first)
})

test('不同文件各自一条连接，且 WAL + busy_timeout 已生效', () => {
  const other = openHubDb('recall-stats-test.db')
  assert.ok(other)
  const mode = (other!.pragma('journal_mode') as Array<{ journal_mode: string }>)[0].journal_mode
  assert.equal(mode, 'wal')
  const timeout = (other!.pragma('busy_timeout') as Array<{ timeout: number }>)[0].timeout
  assert.ok(timeout >= 1000)
  assert.ok(fs.existsSync(path.join(TEST_HOME, 'recall-stats-test.db')))
})

test('closeAllHubDb 释放全部连接', () => {
  closeAllHubDb()
  assert.equal(hubDbConnectionCount(), 0)
})
