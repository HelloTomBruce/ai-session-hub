export interface McpCallLog {
  id: string
  timestamp: number
  type: 'tool' | 'resource' | 'connection'
  name: string
  params?: any
  status: 'success' | 'error'
  durationMs?: number
  error?: string
  responsePreview?: string
}

class McpLogManager {
  private logs: McpCallLog[] = []
  private maxLogs = 100

  addLog(log: Omit<McpCallLog, 'id' | 'timestamp'>) {
    const item: McpCallLog = {
      id: `log_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`,
      timestamp: Date.now(),
      ...log
    }
    this.logs.unshift(item)
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs)
    }
  }

  getLogs(): McpCallLog[] {
    return this.logs
  }

  clearLogs() {
    this.logs = []
  }
}

export const mcpLogger = new McpLogManager()
