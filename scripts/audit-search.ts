/**
 * TOMB-3 检索能力审计脚本
 *
 * 在隔离 HOME 下构建受控合成数据集，直接驱动真实的
 * cacheService.search() 代码路径，验证：
 *  - 中/英/混合内容 FTS5 检索效果（固定查询集）
 *  - 各字段可检索性（content / title / tool_summary / cwd / tags / thought）
 *  - 会话聚合视图与平铺视图的分页/计数准确性
 *  - 筛选（platform / role / cwd / tag）
 *  - 大数据量下的同步与检索性能
 *
 * 运行：HOME=/tmp/sh-audit-home npx tsx scripts/audit-search.ts
 */

import { cacheService } from '../server/utils/cache-service'

// ---------- 数据集定义 ----------

interface AuditMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  thought?: string
  toolCalls?: Array<Record<string, unknown>>
}

interface AuditSession {
  id: string
  platform: string
  title: string
  cwd: string
  tags: string[]
  messages: AuditMessage[]
}

// 哨兵关键词（独特、可控，用于精确断言召回）
const SESSIONS: AuditSession[] = [
  {
    id: 's-zh-search', platform: 'claude', title: '全文检索功能讨论',
    cwd: '/Users/test/project-alpha', tags: ['检索', '后端'],
    messages: [
      { role: 'user', content: '如何实现中文全文检索？需要考虑分词准确性。' },
      { role: 'assistant', content: '可以使用 SQLite FTS5 配合 Intl.Segmenter 做中英文分词，检索效果取决于分词粒度。' },
      { role: 'assistant', content: 'FTS5 的 unicode61 分词器对中文按连续字符成词。', thought: '用户真正想问的其实是语义检索而非关键词检索，zephyrine 思考哨兵词。' }
      //            ^^^^ thought 中独有哨兵词 zephyrine，用于验证 Thinking 是否可搜
    ]
  },
  {
    id: 's-en-cache', platform: 'claude', title: 'Cache service refactor',
    cwd: '/Users/test/project-beta', tags: ['refactor'],
    messages: [
      { role: 'user', content: 'The cache service is over 1000 lines. Should we split the repository layer?' },
      { role: 'assistant', content: 'Yes. Extract QueryBuilder and keep CacheService as a facade. Beware of prefix matching regressions.' }
    ]
  },
  {
    id: 's-mixed-deploy', platform: 'pi', title: '部署 pipeline 排查 deploy pipeline issue',
    cwd: '/Users/test/project-alpha', tags: ['deploy', 'ci'],
    messages: [
      { role: 'user', content: 'CI 一直失败，deploy pipeline 在 pnpm install 阶段超时 timeout。' },
      { role: 'assistant', content: '建议启用 pnpm store 缓存，并检查 network proxy 配置。' }
    ]
  },
  {
    id: 's-tool-heavy', platform: 'pi', title: '自动化脚本编写',
    cwd: '/Users/test/tools', tags: [],
    messages: [
      {
        role: 'assistant', content: '我来读取配置文件。',
        toolCalls: [
          { name: 'read_file', arguments: { path: '/etc/quokka-config.yaml' } },
          { name: 'bash', arguments: { command: 'kubectl apply -f deployment.yaml' } }
        ]
      },
      { role: 'user', content: '配置读取成功了吗？' }
    ]
  },
  {
    id: 's-system-only', platform: 'codex', title: '系统提示词测试会话',
    cwd: '/Users/test/project-gamma', tags: [],
    messages: [
      { role: 'system', content: 'You are a helpful assistant. 内部指令关键词 narwhal 只出现在 system 消息。' },
      { role: 'user', content: '你好' }
    ]
  },
  {
    id: 's-special-chars', platform: 'codex', title: 'C++ 与 user_id 设计',
    cwd: '/Users/test/project-gamma', tags: ['c++'],
    messages: [
      { role: 'user', content: 'user_id 字段应该用 uuid 还是自增整数？C++ 侧如何映射？' },
      { role: 'assistant', content: '建议用 uuid，避免分布式主键冲突。' }
    ]
  },
  {
    id: 's-long-msg', platform: 'opencode', title: '超长消息截断测试',
    cwd: '/Users/test/project-delta', tags: [],
    messages: [
      // 哨兵词放在 60000 字符处，超过 50000 截断点 -> 预期搜不到
      { role: 'assistant', content: '甲'.repeat(60000) + ' truncatedsentinel 截断哨兵' }
    ]
  }
]

// ---------- 工具函数 ----------

function segmentText(seg: Intl.Segmenter, text: string): string {
  if (!text) return ''
  return Array.from(seg.segment(text))
    .map(s => s.segment)
    .filter(s => s.trim().length > 0)
    .join(' ')
}

function extractToolSummary(toolCalls?: Array<Record<string, unknown>>): string {
  // 复刻 cache-service.ts 的私有实现（保持一致）
  if (!toolCalls || !toolCalls.length) return ''
  const parts: string[] = []
  for (const tool of toolCalls) {
    const name = (tool.name || tool.type || '') as string
    if (name) parts.push(name)
    const args = (tool.arguments || tool.args || tool.input) as unknown
    if (args && typeof args === 'object') {
      const str = JSON.stringify(args)
      const matches = str.match(/[\w\-./\\]+\.(?:[a-zA-Z0-9]{1,10})/g)
      if (matches) parts.push(...matches)
      const cmdMatches = str.match(/["'](?:command|cmd|script)["']:\s*["']([^"']+)["']/i)
      if (cmdMatches && cmdMatches[1]) parts.push(cmdMatches[1])
    }
  }
  return parts.slice(0, 15).join(' ')
}

function insertDataset(sessions: AuditSession[]): void {
  const db = cacheService.getDb()
  if (!db) throw new Error('cache db unavailable')
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

  const insertSession = db.prepare(`
    INSERT OR REPLACE INTO sessions_cache
      (id, platform, category, title, cwd, message_count, created_at, updated_at, tags, extra)
    VALUES (?, ?, 'cli', ?, ?, ?, ?, ?, ?, '{}')
  `)
  const insertMsg = db.prepare(`
    INSERT OR REPLACE INTO messages_cache
      (id, session_id, platform, role, content, thought, tool_calls_json, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertFts = db.prepare(`
    INSERT INTO fts_messages(content, title, tool_summary, cwd, tags, message_id, session_id, platform, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const now = Date.now()
  const tx = db.transaction(() => {
    for (const s of sessions) {
      insertSession.run(s.id, s.platform, s.title, s.cwd, s.messages.length, now, now, JSON.stringify(s.tags))
      const tagsStr = segmentText(segmenter, s.tags.join(' '))
      const titleSeg = segmentText(segmenter, s.title || '')
      for (const [idx, msg] of s.messages.entries()) {
        const rawMsgId = String(idx)
        const msgId = `${s.platform}_${s.id}_${rawMsgId}`
        const toolCallsStr = msg.toolCalls ? JSON.stringify(msg.toolCalls) : '[]'
        insertMsg.run(msgId, s.id, s.platform, msg.role, msg.content, msg.thought || null, toolCallsStr, now + idx)

        // 与 cache-service sync() 相同的入索引规则
        if ((msg.role === 'user' || msg.role === 'assistant') && (msg.content || msg.toolCalls?.length)) {
          const toolSummary = extractToolSummary(msg.toolCalls)
          insertFts.run(
            segmentText(segmenter, msg.content.slice(0, 50000)),
            titleSeg,
            segmentText(segmenter, toolSummary),
            s.cwd || '',
            tagsStr,
            rawMsgId,
            s.id,
            s.platform,
            msg.role
          )
        }
      }
    }
  })
  tx()
}

// ---------- 审计执行 ----------

interface QueryCase {
  id: string
  query: string
  lang: 'zh' | 'en' | 'mixed'
  note: string
  expectHitSessionIds?: string[] // 预期命中的会话
  expectNoHit?: boolean // 预期搜不到
  expectHit?: boolean
}

const QUERIES: QueryCase[] = [
  { id: 'Q01', query: '分词', lang: 'zh', note: '中文单词', expectHitSessionIds: ['s-zh-search'] },
  { id: 'Q02', query: '全文检索', lang: 'zh', note: '中文短语（跨消息/标题）', expectHitSessionIds: ['s-zh-search'] },
  { id: 'Q03', query: 'cache', lang: 'en', note: '英文单词（大小写不敏感验证）', expectHitSessionIds: ['s-en-cache'] },
  { id: 'Q04', query: 'CACHE', lang: 'en', note: '英文大写', expectHitSessionIds: ['s-en-cache'] },
  { id: 'Q05', query: 'serv', lang: 'en', note: '英文前缀匹配（t* 语法）', expectHitSessionIds: ['s-en-cache'] },
  { id: 'Q06', query: 'cache service', lang: 'en', note: '英文多词（隐式 AND）', expectHitSessionIds: ['s-en-cache'] },
  { id: 'Q07', query: 'deploy pipeline', lang: 'mixed', note: '中英混合会话中的英文短语', expectHitSessionIds: ['s-mixed-deploy'] },
  { id: 'Q08', query: '部署 pipeline', lang: 'mixed', note: '中英混合查询', expectHitSessionIds: ['s-mixed-deploy'] },
  { id: 'Q09', query: '超时', lang: 'zh', note: '句中中文词（CI 一直失败…超时）', expectHitSessionIds: ['s-mixed-deploy'] },
  { id: 'Q10', query: 'zephyrine', lang: 'en', note: '仅存在于 Thinking(thought) 的哨兵词', expectNoHit: true },
  { id: 'Q11', query: 'narwhal', lang: 'en', note: '仅存在于 system 消息的哨兵词', expectNoHit: true },
  { id: 'Q12', query: 'read_file', lang: 'en', note: '工具调用名称（tool_summary 列）', expectHitSessionIds: ['s-tool-heavy'] },
  { id: 'Q13', query: 'quokka-config', lang: 'en', note: '工具参数中的文件路径片段', expectHitSessionIds: ['s-tool-heavy'] },
  { id: 'Q14', query: 'kubectl', lang: 'en', note: '工具 command 参数', expectHitSessionIds: ['s-tool-heavy'] },
  { id: 'Q15', query: 'project-alpha', lang: 'en', note: 'cwd 路径片段（含连字符）', expectHitSessionIds: ['s-zh-search', 's-mixed-deploy'] },
  { id: 'Q16', query: '检索', lang: 'zh', note: 'tags 列命中（s-zh-search 标签）+ content 命中', expectHit: true },
  { id: 'Q17', query: 'refactor', lang: 'en', note: 'tags 列英文标签', expectHitSessionIds: ['s-en-cache'] },
  { id: 'Q18', query: '自动化脚本', lang: 'zh', note: '仅存在于标题的中文', expectHitSessionIds: ['s-tool-heavy'] },
  { id: 'Q19', query: 'user_id', lang: 'en', note: '含下划线 token', expectHitSessionIds: ['s-special-chars'] },
  { id: 'Q20', query: 'C++', lang: 'en', note: '特殊字符查询（C++）', expectHitSessionIds: ['s-special-chars'] },
  { id: 'Q21', query: 'truncatedsentinel', lang: 'en', note: '超过 50000 字符截断点的哨兵词', expectNoHit: true },
  { id: 'Q22', query: '不存在的东西xyz', lang: 'zh', note: '零结果查询（不应报错）', expectNoHit: true },
  { id: 'Q23', query: '" OR 1=1', lang: 'en', note: 'FTS5 注入/语法攻击（不应报错、不应全量命中）', expectNoHit: true },
  { id: 'Q24', query: '检索 分词', lang: 'zh', note: '中文多词查询（隐式 AND）', expectHitSessionIds: ['s-zh-search'] }
]

function runQueryAudit(): void {
  console.log('\n========== 固定查询集审计 ==========\n')
  const rows: string[] = []
  for (const qc of QUERIES) {
    const t0 = performance.now()
    const res = cacheService.search(qc.query, { groupBy: 'message', limit: 50 })
    const ms = (performance.now() - t0).toFixed(1)
    const hitSessions = [...new Set(res.results.map(r => r.session_id))]
    let verdict = '✅'
    let detail: string
    if (qc.expectNoHit) {
      if (res.total > 0) {
        verdict = '❌'
        detail = `预期0命中，实际 total=${res.total} 命中会话=${hitSessions.join(',')}`
      } else {
        detail = '符合预期：0 命中'
      }
    } else if (qc.expectHitSessionIds) {
      const missing = qc.expectHitSessionIds.filter(id => !hitSessions.includes(id))
      if (missing.length) {
        verdict = '❌'
        detail = `漏召回会话: ${missing.join(',')}（实际命中: ${hitSessions.join(',') || '无'}）`
      } else {
        detail = `命中会话: ${hitSessions.join(',')}`
      }
    } else {
      detail = res.total > 0 ? `命中 ${res.total} 条，会话: ${hitSessions.join(',')}` : '0 命中'
    }
    rows.push(`${qc.id} | ${qc.lang} | "${qc.query}" | total=${res.total} | ${ms}ms | ${verdict} ${detail}`)
  }
  console.log(rows.join('\n'))
}

function runViewAndFilterAudit(): void {
  console.log('\n========== 视图/筛选/分页审计 ==========\n')

  // 1. 会话聚合 vs 平铺
  const grouped = cacheService.search('检索', { groupBy: 'session', limit: 20 })
  const flat = cacheService.search('检索', { groupBy: 'message', limit: 20 })
  console.log(`[视图] "检索": session 视图 groupedSessions=${grouped.groupedSessions?.length} total(msg)=${grouped.total}; message 视图 results=${flat.results.length} total=${flat.total}`)
  console.log(`[视图] session 视图 total 字段语义 = 命中消息数（${grouped.total}），UI 页数按消息数计算`)

  // 2. 平台筛选
  const pFiltered = cacheService.search('检索', { platform: 'claude', groupBy: 'message' })
  console.log(`[筛选] platform=claude: total=${pFiltered.total}, platforms=${JSON.stringify(pFiltered.platforms)}`)
  const pAll = cacheService.search('检索', { platform: 'all', groupBy: 'message' })
  console.log(`[筛选] platform=all: total=${pAll.total}`)

  // 3. 角色筛选
  const rUser = cacheService.search('检索', { role: 'user', groupBy: 'message' })
  const rAsst = cacheService.search('检索', { role: 'assistant', groupBy: 'message' })
  console.log(`[筛选] role=user: ${rUser.total}, role=assistant: ${rAsst.total}, 合计=${rUser.total + rAsst.total}（应等于无筛选 total）`)

  // 4. cwd 筛选（LIKE 匹配 sessions_cache.cwd）
  const cwdFiltered = cacheService.search('检索', { cwd: 'project-alpha', groupBy: 'message' })
  console.log(`[筛选] cwd=project-alpha: total=${cwdFiltered.total}`)

  // 5. tag 筛选（LIKE 匹配 sessions_cache.tags JSON 字符串）
  const tagFiltered = cacheService.search('部署', { tag: 'ci', groupBy: 'message' })
  console.log(`[筛选] 查询"部署" + tag=ci: total=${tagFiltered.total}`)
  const tagBad = cacheService.search('部署', { tag: 'c', groupBy: 'message' })
  console.log(`[筛选] 查询"部署" + tag=c（子串误匹配探测）: total=${tagBad.total}`)

  // 6. 分页一致性（message 视图）
  const page1 = cacheService.search('检索', { groupBy: 'message', limit: 1, offset: 0 })
  const page2 = cacheService.search('检索', { groupBy: 'message', limit: 1, offset: 1 })
  const ids1 = page1.results.map(r => r.rowid)
  const ids2 = page2.results.map(r => r.rowid)
  console.log(`[分页] message 视图 page1 rowid=${ids1}, page2 rowid=${ids2}, 重叠=${ids1.some(i => ids2.includes(i))}, total=${page1.total} vs ${page2.total}`)

  // 7. 聚合视图 matchedCount 与真实命中数对比
  for (const g of grouped.groupedSessions || []) {
    const realCount = cacheService.search('检索', { groupBy: 'message', limit: 100 })
      .results.filter(r => r.session_id === g.session_id).length
    console.log(`[聚合] ${g.session_id}: matchedCount=${g.matchedCount} 实际命中=${realCount} ${g.matchedCount === realCount ? '✅' : '❌'}`)
  }

  // 8. snippet 高亮检查：title-only 命中的 snippet 是否有内容
  const titleHit = cacheService.search('自动化脚本', { groupBy: 'message' })
  for (const r of titleHit.results) {
    console.log(`[高亮] title-only 命中 session=${r.session_id} snippet="${r.snippet}"`)
  }

  // 9. raw_content join 检查（message_id 对不上 messages_cache.id 的疑似 bug）
  const db = cacheService.getDb()!
  const joinCheck = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN m.id IS NULL THEN 1 ELSE 0 END) AS missed
    FROM fts_messages f
    LEFT JOIN messages_cache m ON m.id = f.message_id
  `).get() as { total: number, missed: number }
  console.log(`[join] fts.message_id -> messages_cache.id 连接失败率: ${joinCheck.missed}/${joinCheck.total}`)
}

function generateBulkDataset(sessionCount: number, msgsPerSession: number): void {
  const db = cacheService.getDb()!
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
  const zhWords = ['检索', '分词', '缓存', '会话', '消息', '同步', '性能', '测试', '部署', '数据库', '索引', '优化', '架构', '接口', '前端', '后端']
  const enWords = ['cache', 'search', 'session', 'message', 'sync', 'performance', 'deploy', 'database', 'index', 'optimize', 'pipeline', 'service']
  let rngState = 42
  const rand = () => {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff
    return rngState / 0x7fffffff
  }
  const pick = (arr: string[]) => arr[Math.floor(rand() * arr.length)]

  const insertSession = db.prepare(`INSERT OR REPLACE INTO sessions_cache (id, platform, category, title, cwd, message_count, created_at, updated_at, tags, extra) VALUES (?, ?, 'cli', ?, ?, ?, ?, ?, '[]', '{}')`)
  const insertMsg = db.prepare(`INSERT OR REPLACE INTO messages_cache (id, session_id, platform, role, content, timestamp) VALUES (?, ?, ?, ?, ?, ?)`)
  const insertFts = db.prepare(`INSERT INTO fts_messages(content, title, tool_summary, cwd, tags, message_id, session_id, platform, role) VALUES (?, ?, '', ?, '', ?, ?, ?, ?)`)

  const platforms = ['claude', 'pi', 'codex', 'opencode']
  const now = Date.now()
  const tx = db.transaction(() => {
    for (let i = 0; i < sessionCount; i++) {
      const sid = `bulk-${i}`
      const platform = platforms[i % platforms.length]
      const title = `${pick(zhWords)} ${pick(enWords)} session ${i}`
      const cwd = `/Users/test/bulk-project-${i % 50}`
      insertSession.run(sid, platform, title, cwd, msgsPerSession, now - i * 1000, now - i * 1000)
      const titleSeg = segmentText(segmenter, title)
      for (let j = 0; j < msgsPerSession; j++) {
        const words: string[] = []
        const len = 20 + Math.floor(rand() * 60)
        for (let k = 0; k < len; k++) words.push(rand() < 0.5 ? pick(zhWords) : pick(enWords))
        const content = words.join('，')
        insertMsg.run(`${platform}_${sid}_${j}`, sid, platform, j % 2 ? 'assistant' : 'user', content, now + j)
        insertFts.run(segmentText(segmenter, content), titleSeg, cwd, String(j), sid, platform, j % 2 ? 'assistant' : 'user')
      }
    }
  })
  const t0 = performance.now()
  tx()
  console.log(`[性能] 批量写入 ${sessionCount} 会话 / ${sessionCount * msgsPerSession} 消息（含分词）: ${(performance.now() - t0).toFixed(0)}ms`)
}

function runPerfAudit(): void {
  console.log('\n========== 大数据量性能审计 ==========\n')
  const stats = cacheService.getStats()
  console.log(`数据集规模: sessions=${stats.sessions}, messages=${stats.messages}, fts_entries=${stats.fts_entries}`)

  const perfQueries = [
    ['常见中文词', '检索'],
    ['常见英文词', 'cache'],
    ['中英混合', '检索 cache'],
    ['罕见词', 'pipeline'],
    ['多词 AND', 'session sync database'],
    ['前缀', 'perf']
  ] as const

  for (const [label, q] of perfQueries) {
    // message 视图
    let t0 = performance.now()
    const r1 = cacheService.search(q, { groupBy: 'message', limit: 20 })
    const tMsg = (performance.now() - t0).toFixed(1)
    // session 视图
    t0 = performance.now()
    cacheService.search(q, { groupBy: 'session', limit: 20 })
    const tSess = (performance.now() - t0).toFixed(1)
    // 深分页
    t0 = performance.now()
    cacheService.search(q, { groupBy: 'message', limit: 20, offset: 500 })
    const tDeep = (performance.now() - t0).toFixed(1)
    console.log(`[性能] ${label} "${q}": total=${r1.total} | message=${tMsg}ms session=${tSess}ms 深分页(offset=500)=${tDeep}ms`)
  }

  // 优化器统计信息
  const db = cacheService.getDb()!
  const t0 = performance.now()
  db.prepare(`INSERT INTO fts_messages(fts_messages, rank) VALUES('optimize', 1)`).run()
  console.log(`[性能] FTS optimize: ${(performance.now() - t0).toFixed(0)}ms`)
}

// ---------- main ----------

console.log('DB:', process.env.HOME + '/.session-hub/session-hub.db')
cacheService.init()
if (!cacheService.isAvailable()) throw new Error('cache unavailable')

insertDataset(SESSIONS)
console.log('受控数据集已写入:', JSON.stringify(cacheService.getStats()))

runQueryAudit()
runViewAndFilterAudit()

generateBulkDataset(2000, 25)
runPerfAudit()
