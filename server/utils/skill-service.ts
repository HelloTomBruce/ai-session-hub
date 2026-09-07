import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { UnifiedSkill, SkillDetailResponse, SkillStats } from './skill-types'

const homeDir = os.homedir()

interface SkillSourceConfig {
  platform: string
  platformName: string
  dir: string
  category: 'universal' | 'system' | 'custom' | 'symlink' | 'plugin'
  isBuiltin?: boolean
}

function parseFrontmatter(content: string): { meta: Record<string, string>, body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return { meta: {}, body: content }
  const yamlBlock = match[1]
  const body = content.slice(match[0].length).trim()
  const meta: Record<string, string> = {}

  let currentKey: string | null = null
  let currentValue = ''

  for (const line of yamlBlock.split('\n')) {
    const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/)
    if (keyMatch) {
      if (currentKey) {
        meta[currentKey] = currentValue.trim().replace(/^['"]|['"]$/g, '')
      }
      currentKey = keyMatch[1]
      currentValue = keyMatch[2] || ''
    } else if (currentKey) {
      currentValue += ' ' + line.trim()
    }
  }
  if (currentKey) {
    meta[currentKey] = currentValue.trim().replace(/^['"]|['"]$/g, '')
  }
  return { meta, body }
}

function extractTags(name: string, description: string): string[] {
  const text = (name + ' ' + description).toLowerCase()
  const tags: string[] = []
  if (text.includes('apifox') || text.includes('api') || text.includes('rest') || text.includes('graphql')) tags.push('API / 接口')
  if (text.includes('test') || text.includes('tdd') || text.includes('spec') || text.includes('quality') || text.includes('review')) tags.push('工程与测试')
  if (text.includes('animation') || text.includes('motion') || text.includes('ui') || text.includes('frontend') || text.includes('keyframes') || text.includes('hyperframes')) tags.push('前端动效')
  if (text.includes('doc') || text.includes('markdown') || text.includes('docx') || text.includes('office')) tags.push('文档处理')
  if (text.includes('debug') || text.includes('error') || text.includes('recovery')) tags.push('排错诊断')
  if (text.includes('git') || text.includes('ci-cd') || text.includes('automation') || text.includes('versioning')) tags.push('CI / 自动化')
  if (text.includes('codebase') || text.includes('memory') || text.includes('graph') || text.includes('context')) tags.push('知识图谱')
  if (tags.length === 0) tags.push('通用技能')
  return tags
}

export class SkillService {
  private sources: SkillSourceConfig[] = [
    {
      platform: 'agents',
      platformName: '全局通用 (~/.agents)',
      dir: path.join(homeDir, '.agents', 'skills'),
      category: 'universal'
    },
    {
      platform: 'pi',
      platformName: 'Pi CLI',
      dir: path.join(homeDir, '.pi', 'agent', 'skills'),
      category: 'custom'
    },
    {
      platform: 'codex',
      platformName: 'Codex App',
      dir: path.join(homeDir, '.codex', 'skills'),
      category: 'custom'
    },
    {
      platform: 'codex',
      platformName: 'Codex System',
      dir: path.join(homeDir, '.codex', 'skills', '.system'),
      category: 'system',
      isBuiltin: true
    },
    {
      platform: 'agy',
      platformName: 'AGY CLI',
      dir: path.join(homeDir, '.gemini', 'antigravity-cli', 'skills'),
      category: 'custom'
    },
    {
      platform: 'agy',
      platformName: 'AGY Builtin',
      dir: path.join(homeDir, '.gemini', 'antigravity-cli', 'builtin', 'skills'),
      category: 'system',
      isBuiltin: true
    },
    {
      platform: 'workbuddy',
      platformName: 'WorkBuddy',
      dir: path.join(homeDir, '.workbuddy', 'skills'),
      category: 'custom'
    },
    {
      platform: 'reasonix',
      platformName: 'Reasonix',
      dir: path.join(homeDir, '.reasonix', 'skills'),
      category: 'custom'
    },
    {
      platform: 'opencode',
      platformName: 'OpenCode',
      dir: path.join(homeDir, '.config', 'opencode', 'skills'),
      category: 'custom'
    }
  ]

  private getLockInfo(): Record<string, { version?: string, sourceUrl?: string }> {
    const lockPath = path.join(homeDir, '.agents', '.skill-lock.json')
    if (!fs.existsSync(lockPath)) return {}
    try {
      const data = JSON.parse(fs.readFileSync(lockPath, 'utf-8'))
      return data.skills || {}
    } catch (e) {
      void e
      return {}
    }
  }

  private scanSkills(): UnifiedSkill[] {
    const skills: UnifiedSkill[] = []
    const lockInfo = this.getLockInfo()

    for (const src of this.sources) {
      if (!fs.existsSync(src.dir)) continue
      try {
        const entries = fs.readdirSync(src.dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue
          const fullPath = path.join(src.dir, entry.name)
          let isSymlink = false
          let symlinkTarget: string | undefined
          try {
            const lstat = fs.lstatSync(fullPath)
            if (lstat.isSymbolicLink()) {
              isSymlink = true
              symlinkTarget = fs.readlinkSync(fullPath)
            }
          } catch (e) {
            void e
          }
          const skillMd = path.join(fullPath, 'SKILL.md')
          if (fs.existsSync(skillMd)) {
            try {
              const rawContent = fs.readFileSync(skillMd, 'utf-8')
              const { meta } = parseFrontmatter(rawContent)
              const name = meta.name || entry.name
              const description = meta.description || meta.summary || ('Skill ' + entry.name)
              const lockItem = lockInfo[entry.name]
              let category = src.category
              if (isSymlink) category = 'symlink'
              skills.push({
                id: entry.name,
                name,
                description: description.replace(/\r?\n/g, ' ').trim(),
                platform: src.platform,
                platformName: src.platformName,
                category,
                rawLocation: skillMd,
                skillDir: fullPath,
                isSymlink,
                symlinkTarget,
                isBuiltin: src.isBuiltin || false,
                version: lockItem?.version,
                sourceUrl: lockItem?.sourceUrl,
                tags: extractTags(name, description)
              })
            } catch (err) {
              console.error('Failed reading skill ' + skillMd + ':', err)
            }
          }
        }
      } catch (e) {
        console.error('Failed reading directory ' + src.dir + ':', e)
      }
    }

    const claudePluginFile = path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json')
    if (fs.existsSync(claudePluginFile)) {
      try {
        const pluginData = JSON.parse(fs.readFileSync(claudePluginFile, 'utf-8'))
        const plugins = pluginData.plugins || {}
        for (const [pKey, pList] of Object.entries(plugins)) {
          const list = pList
          if (Array.isArray(list) && list.length > 0) {
            const pInfo = list[0]
            const name = pKey.split('@')[0]
            const installPath = pInfo.installPath || ''
            const readmePath = path.join(installPath, 'README.md')
            let description = 'Claude Plugin: ' + name
            if (fs.existsSync(readmePath)) {
              try {
                const readme = fs.readFileSync(readmePath, 'utf-8')
                const firstLine = readme.split('\n').find(l => l.trim().length > 0 && !l.startsWith('#'))
                if (firstLine) description = firstLine.trim()
              } catch (e) {
                void e
              }
            }
            skills.push({
              id: name,
              name,
              description,
              platform: 'claude',
              platformName: 'Claude Code',
              category: 'plugin',
              rawLocation: fs.existsSync(readmePath) ? readmePath : installPath,
              skillDir: installPath,
              isSymlink: false,
              isBuiltin: false,
              version: pInfo.version,
              tags: extractTags(name, description)
            })
          }
        }
      } catch (e) {
        console.error('Failed reading claude plugins:', e)
      }
    }

    const toolSkills = skills.filter(s => s.platform !== 'agents')
    for (const skill of skills) {
      if (skill.platform === 'agents') {
        const enabled: string[] = []
        for (const ts of toolSkills) {
          if (ts.id === skill.id && !enabled.includes(ts.platform)) {
            enabled.push(ts.platform)
          }
        }
        skill.enabledIn = enabled
      }
    }
    return skills
  }

  getAllSkills(platformFilter?: string, query?: string): { skills: UnifiedSkill[], stats: Record<string, number>, total: number } {
    const all = this.scanSkills()
    const stats: Record<string, number> = {
      all: all.length,
      agents: 0,
      pi: 0,
      codex: 0,
      agy: 0,
      workbuddy: 0,
      reasonix: 0,
      opencode: 0,
      claude: 0
    }
    for (const s of all) {
      if (stats[s.platform] !== undefined) {
        stats[s.platform]++
      }
    }
    let filtered = all
    if (platformFilter && platformFilter !== 'all') {
      filtered = filtered.filter(s => s.platform === platformFilter)
    }
    if (query && query.trim()) {
      const q = query.toLowerCase().trim()
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(q)
        || s.id.toLowerCase().includes(q)
        || s.description.toLowerCase().includes(q)
        || (s.tags && s.tags.some(t => t.toLowerCase().includes(q)))
      )
    }
    return { skills: filtered, stats, total: all.length }
  }

  getSkillDetail(platform: string, id: string): SkillDetailResponse | null {
    const all = this.scanSkills()
    const found = all.find(s => s.id === id && (platform === 'all' || s.platform === platform)) || null
    if (!found) return null
    let readmeContent = ''
    if (fs.existsSync(found.rawLocation)) {
      try {
        readmeContent = fs.readFileSync(found.rawLocation, 'utf-8')
      } catch (e) {
        readmeContent = 'Failed to load document: ' + e
      }
    }
    const files: string[] = []
    if (fs.existsSync(found.skillDir)) {
      try {
        const entries = fs.readdirSync(found.skillDir)
        for (const e of entries) {
          if (!e.startsWith('.')) files.push(e)
        }
      } catch (e) {
        void e
      }
    }
    return { skill: found, readmeContent, files }
  }

  getStats(): SkillStats {
    const all = this.scanSkills()
    const counts: Record<string, number> = {}
    let universalCount = 0
    for (const s of all) {
      counts[s.platform] = (counts[s.platform] || 0) + 1
      if (s.platform === 'agents') universalCount++
    }
    return { total: all.length, universalCount, counts }
  }
}

export const skillService = new SkillService()
