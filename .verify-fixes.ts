/* TOMB-2 修复验证脚本：在隔离 HOME 下验证 H2/H3/H4/M9 与适配器回归 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = process.env.HOME
console.log('sandbox HOME =', home)

// ---------- 1. 模板 SQLite：非标准 FK 列名自动探测 + create/update 真实落库 (H2/H3) ----------
const Database = (await import('better-sqlite3')).default
const dbDir = path.join(home, 'sqlitedb')
fs.mkdirSync(dbDir, { recursive: true })
const dbPath = path.join(dbDir, 'tool.db')
const db = new Database(dbPath)
db.exec(`
  CREATE TABLE chats (id TEXT PRIMARY KEY, name TEXT, modified INTEGER);
  CREATE TABLE msgs (id INTEGER PRIMARY KEY, chat_ref TEXT, sender TEXT, body TEXT, created INTEGER);
  INSERT INTO chats VALUES ('c1', 'First chat', 1700000000000), ('c2', 'Second chat', 1700000100000);
  INSERT INTO msgs (chat_ref, sender, body, created) VALUES
    ('c1', 'user', 'hello world', 1700000001000),
    ('c1', 'assistant', 'hi there', 1700000002000),
    ('c2', 'user', 'unique keyword zebra', 1700000101000);
`)
db.close()

const { TemplateSqlitePlugin } = await import('/Users/zhangbei/code/session-hub/server/utils/plugins/template-sqlite-plugin.ts')
const sqlitePlugin = new TemplateSqlitePlugin({
  id: 'test-sqlite', name: 'Test SQLite', dbPath,
  sessionsTable: 'chats', idColumn: 'id', titleColumn: 'name', updatedAtColumn: 'modified'
} as never)

const sessions = sqlitePlugin.getSessions()
console.log('H2 sessions:', sessions.map(s => `${s.id}=${s.title}`).join(', '))
const msgs = sqlitePlugin.getMessages('c1')
console.log('H2 messages c1:', msgs.length, msgs.map(m => `${m.role}:${m.content}`).join(' | '))

const created = sqlitePlugin.createSession({ title: 'Brand new', cwd: '/tmp' } as never)
const afterCreate = sqlitePlugin.getSessions()
console.log('H3 createSession persisted:', afterCreate.some(s => s.id === created.id && s.title === 'Brand new'))
const upd = sqlitePlugin.updateSession(created.id, { title: 'Renamed' } as never)
const afterUpd = new Database(dbPath).prepare('SELECT name FROM chats WHERE id = ?').get(created.id)
console.log('H3 updateSession:', upd, 'db title =', afterUpd?.name)

// ---------- 2. 模板 JSONL：filePattern/titleField (M9) + create/update (H3) ----------
const jsonlDir = path.join(home, 'jsonl-data')
fs.mkdirSync(jsonlDir, { recursive: true })
fs.writeFileSync(path.join(jsonlDir, 'a.jsonl'), [
  JSON.stringify({ role: 'user', text: 'alpha message', ts: 1700000000000 }),
  JSON.stringify({ role: 'assistant', text: 'beta reply', ts: 1700000001000 })
].join('\n') + '\n')
fs.writeFileSync(path.join(jsonlDir, 'ignore.txt'), 'not a session\n')

const { TemplateJsonlPlugin } = await import('/Users/zhangbei/code/session-hub/server/utils/plugins/template-jsonl-plugin.ts')
const jsonlPlugin = new TemplateJsonlPlugin({
  id: 'test-jsonl', name: 'Test JSONL', baseDir: jsonlDir,
  filePattern: '*.jsonl', roleField: 'role', contentField: 'text', timestampField: 'ts'
} as never)

const js = jsonlPlugin.getSessions()
console.log('M9 sessions (only .jsonl):', js.map(s => `${s.id}`).join(','), '| title fallback:', js[0]?.title)
const jm = jsonlPlugin.getMessages('a')
console.log('M9 messages:', jm.length, jm.map(m => `${m.role}:${m.content}@${m.timestamp}`).join(' | '))

const jc = jsonlPlugin.createSession({ title: 'My new session', initialPrompt: 'seed prompt' } as never)
const js2 = jsonlPlugin.getSessions()
const jt = js2.find(s => s.id === jc.id)?.title
console.log('H3 jsonl create: title =', jt)
const ju = jsonlPlugin.updateSession(jc.id, { title: 'Renamed JSONL' } as never)
const jt2 = jsonlPlugin.getSessions().find(s => s.id === jc.id)?.title
console.log('H3 jsonl update:', ju, 'title =', jt2)

// titleField 提取
fs.writeFileSync(path.join(jsonlDir, 'b.jsonl'), JSON.stringify({ role: 'user', text: 'x', heading: 'Field Title', ts: 1 }) + '\n')
const jsonlPlugin2 = new TemplateJsonlPlugin({
  id: 'test-jsonl2', name: 'T2', baseDir: jsonlDir, titleField: 'heading'
} as never)
console.log('M9 titleField:', jsonlPlugin2.getSessions().find(s => s.id === 'b')?.title)

// ---------- 3. 缓存 prune (H4)：同步 → 删源文件 → 再同步，幽灵会话应消失 ----------
const pluginsDir = path.join(home, '.session-hub', 'plugins')
fs.mkdirSync(pluginsDir, { recursive: true })
fs.writeFileSync(path.join(pluginsDir, 'prune-test.plugin.json'), JSON.stringify({
  id: 'prune-test', name: 'Prune Test', type: 'template-jsonl',
  baseDir: jsonlDir, filePattern: '*.jsonl', contentField: 'text'
}))

const { cacheService } = await import('/Users/zhangbei/code/session-hub/server/utils/cache-service.ts')
const r1 = cacheService.sync()
const list1 = cacheService['db'].prepare('SELECT id, platform FROM sessions_cache WHERE platform = ?').all('prune-test')
console.log('H4 first sync:', JSON.stringify(r1), 'cached:', list1.length)

fs.unlinkSync(path.join(jsonlDir, 'a.jsonl'))
const r2 = cacheService.sync()
const list2 = cacheService['db'].prepare('SELECT id FROM sessions_cache WHERE platform = ?').all('prune-test')
console.log('H4 second sync (a.jsonl removed):', JSON.stringify(r2), 'cached:', list2.map(r => r.id).join(','))

// ---------- 4. 搜索 groupBy=session 分页 (M11) ----------
const search1 = cacheService.search({ query: 'message', groupBy: 'session', page: 1, pageSize: 1 } as never)
const search2 = cacheService.search({ query: 'message', groupBy: 'session', page: 2, pageSize: 1 } as never)
console.log('M11 groupBy total(sessions):', search1.total, '| p1:', search1.groupedSessions?.[0]?.session_id, '| p2:', search2.groupedSessions?.[0]?.session_id)

console.log('DONE')
