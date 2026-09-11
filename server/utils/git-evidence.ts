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
  totalAdditions: number
  totalDeletions: number
  diffStats: string
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

const FILE_KEYS = ['file_path','FilePath','path','AbsolutePath','TargetFile','SearchDirectory','SearchPath','old_path','new_path']

function extractFileToolCalls(messages: SessionMessage[]) {
  const results: Array<{ msgIndex: number; toolName: string; filePaths: string[] }> = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]; if (!msg) continue
    if (!msg.toolCalls?.length) continue
    for (const tc of msg.toolCalls) {
      const name = (tc.name || tc.type || '').toLowerCase()
      const args = tc.arguments || tc.args || tc.input || {}
      const filePaths: string[] = []
      if (name.includes('edit') || name.includes('write') || name.includes('patch') ||
          name.includes('create') || name.includes('delete') || name.includes('rename')) {
        for (const key of FILE_KEYS) {
          if (args[key] && typeof args[key] === 'string') filePaths.push(args[key])
        }
        if (args.CommandLine && typeof args.CommandLine === 'string') {
          for (const part of args.CommandLine.split(/\s+/)) {
            if ((part.startsWith('/') || part.startsWith('.')) && !part.startsWith('-')) filePaths.push(part)
          }
        }
      }
      if (args.file_path) filePaths.push(args.file_path)
      if (args.filePath) filePaths.push(args.filePath)
      if (args.path) filePaths.push(args.path)
      if (args.target) filePaths.push(args.target)
      if (filePaths.length > 0) results.push({ msgIndex: i, toolName: name, filePaths: [...new Set(filePaths)] })
    }
  }
  return results
}

function runGit(cwd: string, cmd: string): string {
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf-8', maxBuffer: 1024 * 1024, timeout: 10000 })
    return String(out).trim()
  } catch {
    return ''
  }
}

function getGitEvidence(cwd: string, created: number, updated: number, toolPaths: string[]) {
  const errors: string[] = []
  const commits: CodeCommit[] = []
  if (!fs.existsSync(path.join(cwd, '.git'))) return { commits: [], errors: ['Not a git repository'] }

  const after = new Date(created - 3600 * 1000).toISOString()
  const before = new Date(updated + 3600 * 1000).toISOString()
  const log = runGit(cwd, `git log --all --after="${after}" --before="${before}" --format="%H||%S||%aI" --name-status`)

  if (!log) return { commits: [], errors }

  for (const entry of log.split('\n\n')) {
    const lines = entry.trim().split('\n')
    const h = lines[0]?.match(/^([a-f0-9]{7,40})\|\|(.+?)\|\|(.+)$/)
    if (!h || !h[1] || !h[2]) continue
    const sha = h[1] || ''; const message = h[2] || ''; const authorDate = h[3] || ''
    const files: CodeChangeFile[] = []

    for (let j = 1; j < lines.length; j++) {
      const lineJ = lines[j]; if (!lineJ) continue; const m = lineJ.trim().match(/^([AMDR])\t(.+)$/)
      if (!m) continue
      const t = m[1] === 'A' ? 'added' : m[1] === 'D' ? 'deleted' : m[1] === 'R' ? 'renamed' : 'modified'
      files.push({ filePath: m[2] || "", changeType: t, additions: 0, deletions: 0 })
    }
    if (files.length === 0) continue

    // Get per-file diff and line counts
    let totalAdditions = 0, totalDeletions = 0
    for (const f of files) {
      const rawDiff = runGit(cwd, `git diff-tree --no-commit-id -r -p ${sha} -- "${f.filePath}"`)
      if (rawDiff) {
        const dl = rawDiff.split('\n')
        f.diff = dl.length > 60 ? dl.slice(0, 60).join('\n') + '\n... (+' + (dl.length - 60) + ' lines)' : rawDiff
        f.additions = (rawDiff.match(/^\+[^+]/gm)?.length) || 0
        f.deletions = (rawDiff.match(/^\-[^-]/gm)?.length) || 0
      }
      totalAdditions += f.additions; totalDeletions += f.deletions
    }

    const diffStats: string = runGit(cwd, `git show ${sha} --format="" --stat --no-color`)
    commits.push({ sha, message, authorDate, files, totalAdditions, totalDeletions, diffStats })
  }

  if (toolPaths.length > 0 && commits.length > 1) {
    const relevant = commits.filter(c => c.files.some(f => toolPaths.some(tp => f.filePath.includes(tp) || tp.includes(f.filePath))))
    return { commits: relevant.length > 0 ? relevant : commits, errors }
  }
  return { commits, errors }
}

export function getCodeEvidence(session: UnifiedSession, messages: SessionMessage[]): CodeEvidenceResult {
  const errors: string[] = []
  if (!session.cwd) { errors.push('No working directory (cwd)'); return { sessionCwd: '', isGitRepo: false, commits: [], totalFilesChanged: 0, totalCommits: 0, matchedToolCalls: [], errors } }

  const matchedToolCalls = extractFileToolCalls(messages)
  const filePaths = matchedToolCalls.flatMap(t => t.filePaths)
  const git = getGitEvidence(session.cwd, session.createdAt, session.updatedAt, filePaths)

  return {
    sessionCwd: session.cwd,
    isGitRepo: fs.existsSync(path.join(session.cwd, '.git')),
    commits: git.commits,
    totalFilesChanged: git.commits.reduce((s, c) => s + c.files.length, 0),
    totalCommits: git.commits.length,
    matchedToolCalls,
    errors: [...errors, ...git.errors]
  }
}
