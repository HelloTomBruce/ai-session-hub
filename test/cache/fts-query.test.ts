import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { escapeFtsQuery } from '../../server/utils/fts-query'

// 回归背景：escapeFtsQuery 曾把独立 `-` 分词拼成 `-*`、把含 `.` 的 token 拼成
// `xxx.yy*`，两者都不是合法 FTS5 bareword，导致
// SqliteError: fts5: syntax error near "*" / "."，且被 catch 吞掉后静默返回空结果。

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
const esc = (q: string) => escapeFtsQuery(q, segmenter)

const db = new Database(':memory:')
db.exec('CREATE VIRTUAL TABLE fts_messages USING fts5(content, tokenize=\'unicode61\')')
// 模拟生产索引方式：CacheService 入库前用 Intl.Segmenter 预分词（unicode61 不切中文）
const segmentText = (t: string) =>
  Array.from(segmenter.segment(t)).map(s => s.segment).filter(s => s.trim()).join(' ')
db.prepare('INSERT INTO fts_messages (content) VALUES (?)').run(segmentText('cache-service 修复了 fts5 syntax error in cache-service.mjs'))
db.prepare('INSERT INTO fts_messages (content) VALUES (?)').run(segmentText('发布版本 v1.2.3，包含中文关键词 缓存服务'))

/** 生成的 MATCH 串必须能被真实 FTS5 执行（语法回归的最终判据） */
function assertExecutable(escaped: string): void {
  assert.doesNotThrow(() => {
    db.prepare('SELECT rowid FROM fts_messages WHERE fts_messages MATCH ?').all(escaped)
  }, `生成的 FTS5 查询非法: ${escaped}`)
}

test('连字符查询不再生成非法 -*（syntax error near "*" 回归）', () => {
  assert.equal(esc('cache-service'), 'cache* service*')
  assertExecutable(esc('cache-service'))
})

test('纯连字符/旗标输入不报错且无检索语义', () => {
  assert.equal(esc('-'), '')
  assert.equal(esc('--flag'), 'flag*')
  assertExecutable(esc('a-b-c'))
})

test('含点的 token（版本号、文件名）走引号短语，不再生成 xxx.yy*', () => {
  assert.equal(esc('v1.2.3'), '"v1.2.3"')
  assertExecutable(esc('v1.2.3'))
  assertExecutable(esc('*.test.ts'))
})

test('用户输入中的 * 与报错原文可安全检索', () => {
  const out = esc('fts5: syntax error near "*"')
  assertExecutable(out)
  // "near" 是纯 bareword，仍走前缀匹配
  assert.match(out, /near\*/)
})

test('foo*bar 这类含 * 的关键词不报错', () => {
  assertExecutable(esc('foo*bar'))
})

test('FTS5 保留字 AND/OR/NOT 裸词被引号包裹', () => {
  assert.equal(esc('AND'), '"AND"')
  assert.equal(esc('and'), '"and"')
  assertExecutable(esc('A and B NOT'))
})

test('中英文混合分词保持原语义', () => {
  // 断言规则而非词典切分结果（ICU 版本不同会切出不同粒度）：
  // 纯中文输入 -> 全部引号短语；混合输入 -> ASCII 得前缀 *，其余引号包裹
  const parts = esc('缓存服务').split(' ')
  assert.ok(parts.length > 0 && parts.every(p => /^"[^"]+"$/.test(p)), esc('缓存服务'))
  const mixed = esc('_私有-123').split(' ')
  assert.equal(mixed[0], '_*')
  assert.equal(mixed[mixed.length - 1], '123*')
  assert.ok(mixed.slice(1, -1).every(p => /^"[^"]+"$/.test(p)), esc('_私有-123'))
  assertExecutable(esc('缓存服务'))
  assertExecutable(esc('_私有-123'))
})

test('空串与纯标点返回空串（调用方据此短路返回空结果）', () => {
  assert.equal(esc(''), '')
  assert.equal(esc('  '), '')
  assert.equal(esc(',.!?'), '')
})

test('功能性检索：修复后连字符查询能命中数据', () => {
  const rows = db.prepare('SELECT rowid FROM fts_messages WHERE fts_messages MATCH ?')
    .all(esc('cache-service')) as { rowid: number }[]
  assert.equal(rows.length, 1)
  const ver = db.prepare('SELECT rowid FROM fts_messages WHERE fts_messages MATCH ?')
    .all(esc('v1.2.3')) as { rowid: number }[]
  assert.equal(ver.length, 1)
  const zh = db.prepare('SELECT rowid FROM fts_messages WHERE fts_messages MATCH ?')
    .all(esc('缓存服务')) as { rowid: number }[]
  assert.equal(zh.length, 1)
})
