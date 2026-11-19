/**
 * 测试数据目录准备：每次 `pnpm test` 前重建 `.test-hub`。
 *
 * 测试通过 HUB_HOME 指向仓库内的临时目录，绝不写用户真实数据目录（~/.session-hub）。
 * 这样既能在沙箱/CI 下跑，也避免测试污染生产库。
 */
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve('.test-hub')
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })
console.log(`[test] HUB_HOME -> ${dir}`)
