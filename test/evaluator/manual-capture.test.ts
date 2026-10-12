import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildManualContent } from '../../server/utils/knowledge-harvest'
import { knowledgeService } from '../../server/utils/knowledge-service'

test('手工沉淀正文：ADR 按 背景/决策/结果 分段拼装', () => {
  const md = buildManualContent({
    title: '会话存储改用 SQLite',
    type: 'ADR',
    summary: 'JSONL 并发写有损坏风险',
    solution: '迁移到 better-sqlite3 单文件库',
    consequence: '查询能力增强，增加原生依赖'
  })

  assert.match(md, /^## 背景\nJSONL 并发写有损坏风险/)
  assert.match(md, /## 决策\n迁移到 better-sqlite3 单文件库/)
  assert.match(md, /## 结果与影响\n查询能力增强，增加原生依赖/)
})

test('手工沉淀正文：非 ADR 的方案段标题为「做法 / 方案」', () => {
  const md = buildManualContent({
    title: 'ESM 目录导入报错',
    type: 'Gotcha',
    summary: 'ERR_UNSUPPORTED_DIR_IMPORT',
    solution: '显式指向入口文件'
  })

  assert.match(md, /## 做法 \/ 方案\n显式指向入口文件/)
  assert.doesNotMatch(md, /结果与影响/)
})

test('手工沉淀正文：summary/solution 为空白时产出空串（候选态不落库）', () => {
  const md = buildManualContent({
    title: '空',
    type: 'Pattern',
    summary: '   ',
    solution: ''
  })
  assert.equal(md, '')
})

test('P4 回归：knowledgeService 已无 saveItem，knowledge_vault 不存在应用层写入入口', () => {
  assert.equal(
    'saveItem' in knowledgeService,
    false,
    'knowledge_vault 停写后不应保留 saveItem（沉淀一律走 knowledgeHarvest → Grafeo）'
  )
})
