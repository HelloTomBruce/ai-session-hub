import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { GrafeoDB } from '@grafeo-db/js'

class GrafeoService {
  private db: GrafeoDB | null = null
  private dbPath: string
  private initialized = false
  private initPromise: Promise<void> | null = null

  constructor() {
    const baseDir = path.join(os.homedir(), '.session-hub')
    this.dbPath = path.join(baseDir, 'memory.grafeo')
  }

  /**
   * 初始化 Grafeo 嵌入式图数据库连接
   */
  async init(): Promise<void> {
    if (this.initialized && this.db) return
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      try {
        const dir = path.dirname(this.dbPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }

        if (fs.existsSync(this.dbPath)) {
          this.db = GrafeoDB.open(this.dbPath)
        } else {
          this.db = GrafeoDB.create(this.dbPath)
        }

        // 初始化文本索引以加速全文/关键词查询
        try {
          await this.db.createTextIndex('Memory', 'title')
          await this.db.createTextIndex('Memory', 'summary')
        } catch {
          // 索引可能已存在
        }

        this.initialized = true
        console.log(`[GrafeoService] Initialized GrafeoDB at ${this.dbPath} (v${this.db.version()})`)
      } catch (err) {
        // 不再静默降级内存库：降级会造成「读取谎报空数据 + 写入静默丢失」双重事故。
        // 典型场景是 memory.grafeo 被其他进程（如遗留的生产 server）独占锁定（GRAFEO-X001），
        // 此时必须让错误显式透出，由调用方/API 层向用户报告。
        this.initialized = false
        this.db = null
        throw new Error(
          `[GrafeoService] 无法打开持久化图数据库 ${this.dbPath}：${(err as { message?: string })?.message || String(err)}`
          + '（常见原因：文件被其他进程锁定，如另一个 session-hub 实例正在运行）',
          { cause: err }
        )
      } finally {
        this.initPromise = null
      }
    })()

    return this.initPromise
  }

  /**
   * 获取数据库实例
   */
  getDb(): GrafeoDB {
    if (!this.db) {
      throw new Error('[GrafeoService] Database not initialized. Call init() first.')
    }
    return this.db
  }

  /**
   * 执行 Cypher / GQL 查询
   */
  async execute(query: string, params?: Record<string, unknown>) {
    await this.init()
    const db = this.getDb()
    return await db.execute(query, params)
  }

  /**
   * 刷新 WAL 检查点
   */
  checkpoint(): void {
    if (this.db) {
      try {
        this.db.walCheckpoint()
      } catch (err) {
        console.warn('[GrafeoService] Error running WAL checkpoint:', err)
      }
    }
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      try {
        this.db.close()
      } catch (err) {
        console.warn('[GrafeoService] Error closing DB:', err)
      }
      this.db = null
      this.initialized = false
    }
  }
}

export const grafeoService = new GrafeoService()
