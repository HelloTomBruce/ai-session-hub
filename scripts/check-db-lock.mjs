/**
 * 启动前自检：探测 Grafeo 图数据库是否可打开。
 *
 * 背景：memory.grafeo 是嵌入式单写者库，dev 与 `pnpm start`（.output 生产服务）
 * 同时运行时会互斥报 GRAFEO-X001（database file is locked），且撞锁后正在运行的
 * dev server 不会自愈，表现为记忆图谱页面 500 无数据。此脚本在启动前把占用进程
 * 直接找出来，给出 kill 命令，避免反复踩坑。
 */
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const dbPath = path.join(os.homedir(), '.session-hub', 'memory.grafeo')
const require = createRequire(path.join(process.cwd(), 'package.json'))

let GrafeoDB
try {
  ;({ GrafeoDB } = require('@grafeo-db/js'))
} catch {
  // 依赖未装好等情况交给后续启动流程报错，这里不拦
  process.exit(0)
}

try {
  const db = GrafeoDB.open(dbPath)
  db.close()
  console.log(`✓ Grafeo 图数据库可正常打开：${dbPath}`)
} catch (err) {
  console.error(`✗ 无法打开 Grafeo 图数据库：${dbPath}`)
  console.error(`  原因：${err?.message || err}`)
  console.error('  典型场景：另一个 session-hub 实例（如遗留的 pnpm start / .output 服务）正在占用。')

  try {
    const out = execSync(`lsof -- "${dbPath}" 2>/dev/null || true`, { encoding: 'utf8' })
    const lines = out.trim().split('\n').filter(Boolean)
    if (lines.length > 1) {
      console.error('\n占用该数据库的进程：')
      console.error(lines.join('\n'))
      const pids = [...new Set(lines.slice(1).map(l => l.trim().split(/\s+/)[1]).filter(Boolean))]
      console.error(`\n结束占用进程后重试：`)
      console.error(`  kill ${pids.join(' ')}`)
    } else {
      console.error('\n未发现持有该文件的进程（可能为残留锁），可尝试重启终端或检查文件权限后重试。')
    }
  } catch {
    // lsof 不可用时忽略
  }
  process.exit(1)
}
