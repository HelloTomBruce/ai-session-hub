#!/usr/bin/env node

/**
 * Session Hub CLI (hub)
 * 终端伴侣工具：将记忆召回、避坑查阅、跨工具会话检索与自动收割带入编码第一现场。
 */

import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import Database from 'better-sqlite3'

// HUB_HOME 与服务端共用同一数据目录约定，便于测试/演示用临时目录隔离
const DB_DIR = process.env.HUB_HOME || path.join(os.homedir(), '.session-hub')
const DB_PATH = path.join(DB_DIR, 'session-hub.db')
const GRAFEO_PATH = path.join(DB_DIR, 'memory.grafeo')
const API_BASE = process.env.SESSION_HUB_URL || 'http://localhost:3877'

// ANSI Colors
const bold = s => `\x1b[1m${s}\x1b[0m`
const green = s => `\x1b[32m${s}\x1b[0m`
const yellow = s => `\x1b[33m${s}\x1b[0m`
const cyan = s => `\x1b[36m${s}\x1b[0m`
const red = s => `\x1b[31m${s}\x1b[0m`
const gray = s => `\x1b[90m${s}\x1b[0m`

function printHelp() {
  console.log(`
${bold('AI Session Hub CLI')} - 开发者身边的伴随式记忆与效能中枢

${bold('用法:')}
  hub <命令> [选项]

${bold('核心命令:')}
  ${cyan('gotcha')} [关键词]        秒查当前项目或全局的避坑指南 (Gotchas)
  ${cyan('recall')} [关键词]        召回相关架构决策 (ADR)、最佳实践与模式
  ${cyan('search')} <关键词>        跨 12+ AI 工具全文检索历史会话与报错
  ${cyan('harvest')} [数量]         触发自动收割高价值会话为知识记忆 (默认 5 条)
  ${cyan('status')}                查看中枢会话统计、记忆图谱与收割状态
  ${cyan('help')}                  显示此帮助信息

${bold('示例:')}
  hub gotcha "nitro external"
  hub recall "monorepo"
  hub search "sqlite lock"
  hub harvest 3
  hub status
`)
}

async function checkServerOnline() {
  try {
    const res = await fetch(`${API_BASE}/api/cli/stats`, { signal: AbortSignal.timeout(800) })
    return res.ok
  } catch {
    return false
  }
}

async function cmdStatus() {
  console.log(bold('\n🔍 Session Hub 运行状态检查\n'))

  const isOnline = await checkServerOnline()
  console.log(`服务状态:   ${isOnline ? green('● 运行中 (HTTP ' + API_BASE + ')') : gray('○ 未启动 (离线直读 SQLite 模式)')}`)

  if (!fs.existsSync(DB_PATH)) {
    console.log(red('未找到本地数据库 (~/.session-hub/session-hub.db)'))
    return
  }

  const db = new Database(DB_PATH, { readonly: true })

  try {
    const sessionCount = db.prepare('SELECT COUNT(*) as c FROM sessions_cache').get().c
    const ftsCount = db.prepare('SELECT COUNT(*) as c FROM fts_messages').get().c

    const platformRows = db.prepare('SELECT platform, COUNT(*) as c FROM sessions_cache GROUP BY platform ORDER BY c DESC').all()
    const platforms = platformRows.map(r => `${r.platform}: ${r.c}`).join('  ')

    console.log(`聚合会话:   ${bold(sessionCount)} 个 (${platforms})`)
    console.log(`索引消息:   ${bold(ftsCount)} 条全文索引记录`)

    // 收割统计
    let harvestStats = { harvested: 0, skipped: 0, failed: 0 }
    try {
      const hRows = db.prepare('SELECT status, COUNT(*) as c FROM session_harvests GROUP BY status').all()
      for (const r of hRows) {
        if (r.status === 'harvested') harvestStats.harvested = r.c
        if (r.status === 'skipped') harvestStats.skipped = r.c
        if (r.status === 'failed') harvestStats.failed = r.c
      }
      console.log(`自动收割:   已收割 ${green(harvestStats.harvested)}  |  跳过 ${gray(harvestStats.skipped)}  |  待收割 ${yellow(Math.max(0, sessionCount - harvestStats.harvested - harvestStats.skipped - harvestStats.failed))}`)
    } catch {
      console.log(`自动收割:   ${gray('未初始化')}`)
    }

    // 记忆图谱统计
    if (fs.existsSync(GRAFEO_PATH)) {
      console.log(`记忆图谱:   ${green('● 就绪')} (~/.session-hub/memory.grafeo)`)
    } else {
      console.log(`记忆图谱:   ${gray('○ 未生成')}`)
    }
  } finally {
    db.close()
  }
  console.log('')
}

async function cmdRecall(query = '', typeFilter = null) {
  const isOnline = await checkServerOnline()
  const cwd = process.cwd()

  if (isOnline) {
    try {
      const res = await fetch(`${API_BASE}/api/memory/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          cwd,
          type: typeFilter || undefined,
          limit: 5
        })
      })
      const data = await res.json()
      displayMemories(data.memories || [])
      return
    } catch {
      // 回退离线模式
    }
  }

  // 离线直读模式
  if (!fs.existsSync(GRAFEO_PATH)) {
    console.log(yellow('\n未找到记忆库 (~/.session-hub/memory.grafeo)。建议启动 session-hub 后执行 `hub harvest` 提炼知识。\n'))
    return
  }

  try {
    const { GrafeoDB } = await import('@grafeo-db/js')
    const db = GrafeoDB.open(GRAFEO_PATH)
    const cypher = `
      MATCH (m:Memory)
      RETURN m.id as id, m.title as title, m.type as type, m.summary as summary, m.confidence as confidence, m.tagsJson as tagsJson
      LIMIT 20
    `
    const res = await db.execute(cypher)
    const rows = (res && typeof res.rows === 'function' ? res.rows() : []) || []
    const results = []

    for (const row of rows) {
      const [id, title, type, summary, confidence] = row || []
      if (typeFilter && type !== typeFilter) continue
      const titleStr = String(title || '')
      const summaryStr = String(summary || '')
      if (query) {
        const text = `${titleStr} ${summaryStr}`.toLowerCase()
        if (!text.includes(query.toLowerCase())) continue
      }
      results.push({
        id,
        title: titleStr,
        type: String(type || 'Gotcha'),
        summary: summaryStr,
        confidence: Number(confidence) || 80
      })
      if (results.length >= 5) break
    }

    displayMemories(results)
  } catch (err) {
    console.log(yellow(`\n离线读取记忆库受限: ${err.message}`))
    console.log(gray(`建议在 session-hub 目录执行 'pnpm dev' 启动中枢服务以获得最佳体验。\n`))
  }
}

function displayMemories(memories) {
  if (!memories || memories.length === 0) {
    console.log(yellow('\n未找到相关记忆。建议执行 `hub harvest` 自动从历史会话提炼知识。\n'))
    return
  }

  console.log(bold(`\n💡 召回 ${memories.length} 条工程知识资产:\n`))

  for (const m of memories) {
    const typeColor = m.type === 'Gotcha' ? yellow : m.type === 'ADR' ? cyan : green
    console.log(`${typeColor(`[${m.type}]`)} ${bold(m.title)}  ${gray(`(置信度: ${m.confidence || 80}%)`)}`)
    if (m.summary) {
      console.log(`   ${gray('摘要:')} ${m.summary}`)
    }
    if (m.projects && m.projects.length) {
      console.log(`   ${gray('项目:')} ${m.projects.map(p => p.name).join(', ')}`)
    }
    if (m.techConcepts && m.techConcepts.length) {
      console.log(`   ${gray('技术:')} ${m.techConcepts.map(t => t.name).join(', ')}`)
    }
    if (m.snippets && m.snippets.length) {
      console.log(`   ${gray('核心片段:')}`)
      for (const s of m.snippets) {
        console.log(`     ${cyan(s.title || '代码模式')}:`)
        console.log(gray('     ' + s.code.replace(/\n/g, '\n     ')))
      }
    }
    console.log('')
  }
}

async function cmdSearch(keywords) {
  if (!keywords) {
    console.log(red('请提供搜索关键词，例如: hub search "sqlite lock"'))
    return
  }

  if (!fs.existsSync(DB_PATH)) {
    console.log(red('未找到本地会话缓存数据库'))
    return
  }

  const db = new Database(DB_PATH, { readonly: true })
  try {
    // 使用 FTS5 全文搜索
    const formatted = keywords.replace(/"/g, '""')
    const sql = `
      SELECT m.session_id, m.platform, m.role, m.content, m.thought, s.title, s.cwd, s.updated_at
      FROM fts_messages f
      JOIN messages_cache m ON f.rowid = m.rowid
      JOIN sessions_cache s ON m.session_id = s.id AND m.platform = s.platform
      WHERE fts_messages MATCH ?
      LIMIT 8
    `
    const rows = db.prepare(sql).all(`"${formatted}"*`)

    if (rows.length === 0) {
      console.log(yellow(`\n未找到包含 "${keywords}" 的历史会话。\n`))
      return
    }

    console.log(bold(`\n🔍 命中 ${rows.length} 条历史对话与工具轨迹:\n`))
    for (const r of rows) {
      console.log(`${cyan(`[${r.platform.toUpperCase()}]`)} ${bold(r.title || '未命名会话')} ${gray(`(${new Date(r.updated_at).toLocaleDateString()})`)}`)
      console.log(`   ${gray('目录:')} ${r.cwd || 'N/A'}  |  ${gray('角色:')} ${r.role}`)
      const text = (r.thought || r.content || '').slice(0, 160).replace(/\n/g, ' ')
      console.log(`   ${gray('片段:')} ${text}...`)
      console.log('')
    }
  } catch (err) {
    console.log(red(`搜索失败: ${err.message}`))
  } finally {
    db.close()
  }
}

async function cmdHarvest(countStr = '5') {
  const count = parseInt(countStr, 10) || 5
  const isOnline = await checkServerOnline()

  console.log(bold(`\n🌾 正在启动自动收割流水线 (目标: ${count} 条候选会话)...\n`))

  if (isOnline) {
    try {
      const res = await fetch(`${API_BASE}/api/memory/auto-harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: count })
      })
      const result = await res.json()
      displayHarvestResult(result)
      return
    } catch (e) {
      console.log(red(`请求 Session Hub 服务失败: ${e.message}`))
      return
    }
  }

  console.log(yellow(`Session Hub 服务未启动 (http://localhost:3877)。请先执行 'pnpm dev' 启动服务。`))
}

function displayHarvestResult(result) {
  if (!result || !result.records) {
    console.log(yellow('收割完成，无新增记录。'))
    return
  }

  console.log(`扫描完成: 总计扫描 ${result.totalScanned} 条  |  ${green(`成功入库 ${result.harvested} 条`)}  |  ${gray(`跳过 ${result.skipped} 条`)}  |  ${red(`失败 ${result.failed} 条`)}\n`)

  for (const r of result.records) {
    if (r.status === 'harvested') {
      console.log(` ${green('✔ [已入库]')} ${bold(r.title)}`)
      console.log(`   ${gray('Memory ID:')} ${r.memoryId}`)
    } else if (r.status === 'skipped') {
      console.log(` ${gray('○ [已跳过]')} ${r.title} ${gray(`(${r.reason})`)}`)
    } else {
      console.log(` ${red('✖ [失 败]')} ${r.title} ${gray(`(${r.reason})`)}`)
    }
  }
  console.log('')
}

async function main() {
  const args = process.argv.slice(2)
  const cmd = args[0] || 'help'

  switch (cmd) {
    case 'gotcha':
      await cmdRecall(args.slice(1).join(' '), 'Gotcha')
      break
    case 'recall':
      await cmdRecall(args.slice(1).join(' '))
      break
    case 'search':
    case 'fts':
      await cmdSearch(args.slice(1).join(' '))
      break
    case 'harvest':
      await cmdHarvest(args[1])
      break
    case 'status':
      await cmdStatus()
      break
    case 'help':
    case '--help':
    case '-h':
    default:
      printHelp()
      break
  }
}

main().catch((err) => {
  console.error(red(`\n执行错误: ${err.message}\n`))
  process.exit(1)
})
