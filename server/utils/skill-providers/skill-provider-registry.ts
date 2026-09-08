import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { SkillProvider } from './base-skill-provider'
import { DirectorySkillProvider } from './directory-skill-provider'
import { ClaudePluginSkillProvider } from './claude-plugin-skill-provider'
import type { UnifiedSkill, SkillStats, SkillDetailResponse } from '../skill-types'

const homeDir = os.homedir()

function getGlobalLockInfo(): Record<string, { version?: string, sourceUrl?: string }> {
  const lockPath = path.join(homeDir, '.agents', '.skill-lock.json')
  if (!fs.existsSync(lockPath)) return {}
  try {
    const data = JSON.parse(fs.readFileSync(lockPath, 'utf-8'))
    return data.skills || {}
  } catch {
    return {}
  }
}

export class SkillProviderRegistry {
  private providers: SkillProvider[] = []

  register(provider: SkillProvider): this {
    this.providers.push(provider)
    return this
  }

  getAllProviders(): SkillProvider[] {
    return this.providers
  }

  scanAllSkills(): UnifiedSkill[] {
    const skills: UnifiedSkill[] = []

    for (const provider of this.providers) {
      if (provider.isAvailable()) {
        try {
          skills.push(...provider.getSkills())
        } catch (e) {
          console.error(`[SkillProviderRegistry] Error reading skills from ${provider.platform}:`, e)
        }
      }
    }

    // Map which tools enable ~/.agents universal skills
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
    const all = this.scanAllSkills()
    const stats: Record<string, number> = {
      all: all.length,
      agents: 0
    }

    for (const p of this.providers) {
      stats[p.platform] = 0
    }

    for (const s of all) {
      stats[s.platform] = (stats[s.platform] || 0) + 1
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
    const all = this.scanAllSkills()
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
      } catch {
        // ignore
      }
    }

    return { skill: found, readmeContent, files }
  }

  getStats(): SkillStats {
    const all = this.scanAllSkills()
    const counts: Record<string, number> = {}
    let universalCount = 0

    for (const s of all) {
      counts[s.platform] = (counts[s.platform] || 0) + 1
      if (s.platform === 'agents') universalCount++
    }

    return { total: all.length, universalCount, counts }
  }
}

export const skillRegistry = new SkillProviderRegistry()

// Register standard sources
skillRegistry
  .register(new DirectorySkillProvider({
    platform: 'agents',
    platformName: '全局通用 (~/.agents)',
    dir: path.join(homeDir, '.agents', 'skills'),
    category: 'universal',
    lockInfoProvider: getGlobalLockInfo
  }))
  .register(new DirectorySkillProvider({
    platform: 'pi',
    platformName: 'Pi CLI',
    dir: path.join(homeDir, '.pi', 'agent', 'skills'),
    category: 'custom'
  }))
  .register(new DirectorySkillProvider({
    platform: 'codex',
    platformName: 'Codex App',
    dir: path.join(homeDir, '.codex', 'skills'),
    category: 'custom'
  }))
  .register(new DirectorySkillProvider({
    platform: 'codex',
    platformName: 'Codex System',
    dir: path.join(homeDir, '.codex', 'skills', '.system'),
    category: 'system',
    isBuiltin: true
  }))
  .register(new DirectorySkillProvider({
    platform: 'agy',
    platformName: 'AGY CLI',
    dir: path.join(homeDir, '.gemini', 'antigravity-cli', 'skills'),
    category: 'custom'
  }))
  .register(new DirectorySkillProvider({
    platform: 'agy',
    platformName: 'AGY Builtin',
    dir: path.join(homeDir, '.gemini', 'antigravity-cli', 'builtin', 'skills'),
    category: 'system',
    isBuiltin: true
  }))
  .register(new DirectorySkillProvider({
    platform: 'workbuddy',
    platformName: 'WorkBuddy',
    dir: path.join(homeDir, '.workbuddy', 'skills'),
    category: 'custom'
  }))
  .register(new DirectorySkillProvider({
    platform: 'reasonix',
    platformName: 'Reasonix',
    dir: path.join(homeDir, '.reasonix', 'skills'),
    category: 'custom'
  }))
  .register(new DirectorySkillProvider({
    platform: 'opencode',
    platformName: 'OpenCode',
    dir: path.join(homeDir, '.config', 'opencode', 'skills'),
    category: 'custom'
  }))
  .register(new ClaudePluginSkillProvider())
