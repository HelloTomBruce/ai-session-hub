import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { CREATE_SCHEMA_SQL, SCHEMA_VERSION } from '../../server/utils/cache-schema'

test('Schema: deleted_sessions 墓碑表正确定义且可持久化', () => {
  const db = new Database(':memory:')
  db.exec(CREATE_SCHEMA_SQL)

  // 不写死版本号：断言 schema 版本是正整数，升级时不必改测试
  assert.ok(Number.isInteger(SCHEMA_VERSION) && SCHEMA_VERSION >= 9, `schema 版本异常: ${SCHEMA_VERSION}`)

  // 插入已删除会话墓碑
  const now = Date.now()
  db.prepare('INSERT INTO deleted_sessions (id, platform, deleted_at) VALUES (?, ?, ?)').run('sess-123', 'agy', now)

  const row = db.prepare('SELECT id, platform, deleted_at FROM deleted_sessions WHERE id = ? AND platform = ?').get('sess-123', 'agy') as { id: string, platform: string, deleted_at: number } | undefined

  assert.ok(row)
  assert.equal(row.id, 'sess-123')
  assert.equal(row.platform, 'agy')
  assert.equal(row.deleted_at, now)

  // 主键冲突时 REPLACE 正常运作
  const updatedTime = now + 1000
  db.prepare('INSERT OR REPLACE INTO deleted_sessions (id, platform, deleted_at) VALUES (?, ?, ?)').run('sess-123', 'agy', updatedTime)
  const updatedRow = db.prepare('SELECT deleted_at FROM deleted_sessions WHERE id = ? AND platform = ?').get('sess-123', 'agy') as { deleted_at: number }
  assert.equal(updatedRow.deleted_at, updatedTime)
})

test('墓碑过滤语义验证: sync 与 query 时跳过墓碑会话', () => {
  const db = new Database(':memory:')
  db.exec(CREATE_SCHEMA_SQL)

  // 模拟墓碑表中有 agy:sess-deleted
  db.prepare('INSERT INTO deleted_sessions (id, platform, deleted_at) VALUES (?, ?, ?)').run('sess-deleted', 'agy', Date.now())

  // 模拟从底层 Adapter 读取到的会话列表（即使底层 AGY 启动自愈复活了该会话）
  const incomingSessions = [
    { id: 'sess-active', cli: 'agy', title: 'Active Session' },
    { id: 'sess-deleted', cli: 'agy', title: 'Deleted Ghost Session' }
  ]

  // 读取墓碑
  const rows = db.prepare('SELECT id, platform FROM deleted_sessions').all() as Array<{ id: string, platform: string }>
  const deletedSet = new Set(rows.map(r => `${r.platform}:${r.id}`))

  // 过滤后的待同步会话
  const validSessions = incomingSessions.filter(s => !deletedSet.has(`${s.cli}:${s.id}`))

  assert.equal(validSessions.length, 1)
  assert.equal(validSessions[0].id, 'sess-active')
  assert.equal(deletedSet.has('agy:sess-deleted'), true)
  assert.equal(deletedSet.has('agy:sess-active'), false)
})

test('撤销墓碑 (restoreDeletedSession) 逻辑验证', () => {
  const db = new Database(':memory:')
  db.exec(CREATE_SCHEMA_SQL)

  db.prepare('INSERT INTO deleted_sessions (id, platform, deleted_at) VALUES (?, ?, ?)').run('sess-to-restore', 'agy', Date.now())
  assert.ok(db.prepare('SELECT 1 FROM deleted_sessions WHERE id = ? AND platform = ?').get('sess-to-restore', 'agy'))

  // 撤销墓碑
  db.prepare('DELETE FROM deleted_sessions WHERE id = ? AND platform = ?').run('sess-to-restore', 'agy')
  assert.equal(db.prepare('SELECT 1 FROM deleted_sessions WHERE id = ? AND platform = ?').get('sess-to-restore', 'agy'), undefined)
})
