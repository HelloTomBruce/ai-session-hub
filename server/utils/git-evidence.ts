import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { SessionMessage, UnifiedSession } from './types'

export interface CodeChangeFile {
  filePath: string
  changeType: 'modified' | 'added' | 'deleted' | 'renamed'
  additions: number
  deletions: number
  diff?: string
}

export interface CodeCommit {
  sha: string
  message: string
  authorDate: string
  files: CodeChangeFile[]
}

export interface CodeEvidenceResult {
  sessionCwd: string
  isGitRepo: boolean
  commits: CodeCommit[]
  totalFilesChanged: number
  totalCommits: number
  matchedToolCalls: Array<{
    msgIndex: number
    toolName: string
    filePaths: string[]
  }>
  errors: string[]
}

/**
 * 从会话中提取与文件修改相关的 Tool Calls
 */
function extractFileToolCalls(messages: SessionMessage[]): Array<{
  msgIndex: number
  toolName: string
  filePaths: string[]
}> {
  const results: Array<{ msgIndex: number; toolName: string; filePaths: string[] }> = []
  const filePatterns = [
    'file_path', 'FilePath', 'path', 'AbsolutePath',
    'TargetFile', 'SearchDirectory', 'SearchPath',
    'old_path', 'new_path'
  ]

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg.toolCalls?.length) continue

    for (const tc of msg.toolCalls) {
      const name = (tc.name || tc.type || '').toLowerCase()
      const args = tc.arguments || tc.args || tc.input || {}
      const filePaths: string[] = []

      // 根据工具名和参数提取文件路径
      if (name.includes('edit') || name.includes('write') || name.includes('patch') ||
          name.includes('create') || name.includes('delete') || name.includes('rename')) {
        for (const key of filePatterns) {
          if (args[key] && typeof args[key] === 'string') {
            filePaths.push(args[key])
          }
        }
        // 从 CommandLine 提取路径
        if (args.CommandLine && typeof args.CommandLine === 'string') {
          const cmdParts = args.CommandLine.split(/\s+/)
          for (const part of cmdParts) {
            if ((part.startsWith('/') || part.startsWith('.')) && !part.startsWith('-')) {
              filePaths.push(part)
            }
          }
        }
      }

      // 处理 OpenAI Codex 风格的 tool calls
      if (args.file_path) filePaths.push(args.file_path)
      if (args.filePath) filePaths.push(args.filePath)
      if (args.path) filePaths.push(args.path)
      if (args.target) filePaths.push(args.target)

      if (filePaths.length > 0) {
        results.push({
          msgIndex: i,
          toolName: name,
          filePaths: [...new Set(filePaths)]
        })
      }
    }
  }

  return results
}

/**
 * 获取会话时间窗口内的 git commit 和文件变更
 */
function getGitEvidence(
  cwd: string,
  sessionCreatedAt: number,
  sessionUpdatedAt: number,
  toolFilePaths: string[]
): { commits: CodeCommit[]; errors: string[] } {
  const errors: string[] = []
  const commits: CodeCommit[] = []

  // 检查是否为 git 仓库
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    return { commits: [], errors: ['Not a git repository'] }
  }

  // 时间窗口：会话创建前 1 小时 ～ 会话更新后 1 小时
  const after = new Date(sessionCreatedAt - 3600 * 1000).toISOString()
  const before = new Date(sessionUpdatedAt + 3600 * 1000).toISOString()

  try {
    const logOutput = execSync(
      `git log --all --after="${after}" --before="${before}" --format="%H||%s||%aI" --name-status`,
      { cwd, encoding: 'utf-8', maxBuffer: 1024 * 1024, timeout: 10000 }
    ).trim()

    if (!logOutput) return { commits: [], errors: [] }

    // 解析 git log 输出
    const entries = logOutput.split('\n\n') // 每个 commit 以空行分隔
    for (const entry of entries) {
      const lines = entry.trim().split('\n')
      if (lines.length < 1) continue

      const headerMatch = lines[0].match(/^([a-f0-9]{7,40})\|\|(.+?)\|\|(.+)$/)
      if (!headerMatch) continue

      const sha = headerMatch[1]
      const message = headerMatch[2]
      const authorDate = headerMatch[3]
      const files: CodeChangeFile[] = []

      // 后续行是 --name-status 输出：M\tpath/to/file
      for (let j = 1; j < lines.length; j++) {
        const line = lines[j].trim()
        if (!line || line.startsWith('#')) continue

        const statusMatch = line.match(/^([AMDR])\t(.+)$/)
        if (!statusMatch) continue

        const statusChar = statusMatch[1]
        const filePath = statusMatch[2]
        let changeType: CodeChangeFile['changeType'] = 'modified'
        if (statusChar === 'A') changeType = 'added'
        else if (statusChar === 'D') changeType = 'deleted'
        else if (statusChar === 'R') changeType = 'renamed'

        files.push({
          filePath,
          changeType,
          additions: 0,
          deletions: 0
        })
      }

      if (files.length > 0) {
        commits.push({ sha, message, authorDate, files })
      }
    }

    // 如果指定了 toolFilePaths，筛选相关 commits
    if (toolFilePaths.length > 0 && commits.length > 0) {
      const relevantCommits: CodeCommit[] = []
      for (const commit of commits) {
        const matchedFiles = commit.files.filter(f =>
          toolFilePaths.some(tfp =>
            f.filePath.includes(tfp) || tfp.includes(f.filePath)
          )
        )
        if (matchedFiles.length > 0) {
          relevantCommits.push({ ...commit, files: matchedFiles })
        }
      }
      return { commits: relevantCommits.length > 0 ? relevantCommits : commits, errors }
    }

    return { commits, errors }
  } catch (err: any) {
    errors.push(`Git error: ${err.message || err}`)
    return { commits, errors }
  }
}

/**
 * 获取会话的 git diff 摘要
 */
function getGitDiff(cwd: string, sha: string): string {
  try {
    return execSync(
      `git show ${sha} --format="" --stat --no-color`,
      { cwd, encoding: 'utf-8', maxBuffer: 1024 * 1024, timeout: 5000 }
    ).trim()
  } catch {
    return ''
  }
}

/**
 * 主函数：从会话中提取代码变更证据
 */
export function getCodeEvidence(
  session: UnifiedSession,
  messages: SessionMessage[]
): CodeEvidenceResult {
  const result: CodeEvidenceResult = {
    sessionCwd: session.cwd || '',
    isGitRepo: false,
    commits: [],
    totalFilesChanged: 0,
    totalCommits: 0,
    matchedToolCalls: [],
    errors: []
  }

  if (!session.cwd) {
    result.errors.push('No working directory (cwd) for this session')
    return result
  }

  // 检查 git
  result.isGitRepo = fs.existsSync(path.join(session.cwd, '.git'))

  // 提取文件 tool calls
  result.matchedToolCalls = extractFileToolCalls(messages)

  // 获取 git evidence
  const filePaths = result.matchedToolCalls.flatMap(t => t.filePaths)
  const gitResult = getGitEvidence(
    session.cwd,
    session.createdAt,
    session.updatedAt,
    filePaths
  )

  result.commits = gitResult.commits
  result.errors = [...result.errors, ...gitResult.errors]
  result.totalCommits = gitResult.commits.length
  result.totalFilesChanged = gitResult.commits.reduce(
    (sum, c) => sum + c.files.length, 0
  )

  return result
}
