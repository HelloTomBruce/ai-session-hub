import fs from 'node:fs'
import path from 'node:path'
import type { SkillProvider } from './base-skill-provider'
import { parseFrontmatter, extractSkillTags } from './base-skill-provider'
import type { UnifiedSkill } from '../skill-types'

export interface DirectorySkillProviderOptions {
  platform: string
  platformName: string
  dir: string
  category: 'universal' | 'system' | 'custom' | 'symlink' | 'plugin'
  isBuiltin?: boolean
  lockInfoProvider?: () => Record<string, { version?: string, sourceUrl?: string }>
}

/**
 * Reusable Directory Skill Provider.
 * Scans any directory containing skill folders with SKILL.md.
 */
export class DirectorySkillProvider implements SkillProvider {
  readonly platform: string
  readonly platformName: string
  readonly dir: string
  readonly category: 'universal' | 'system' | 'custom' | 'symlink' | 'plugin'
  readonly isBuiltin: boolean
  private lockInfoProvider?: () => Record<string, { version?: string, sourceUrl?: string }>

  constructor(options: DirectorySkillProviderOptions) {
    this.platform = options.platform
    this.platformName = options.platformName
    this.dir = options.dir
    this.category = options.category
    this.isBuiltin = Boolean(options.isBuiltin)
    this.lockInfoProvider = options.lockInfoProvider
  }

  isAvailable(): boolean {
    return fs.existsSync(this.dir)
  }

  getSkills(): UnifiedSkill[] {
    if (!this.isAvailable()) return []

    const skills: UnifiedSkill[] = []
    const lockInfo = this.lockInfoProvider ? this.lockInfoProvider() : {}

    try {
      const entries = fs.readdirSync(this.dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const fullPath = path.join(this.dir, entry.name)
        let isSymlink = false
        let symlinkTarget: string | undefined

        try {
          const lstat = fs.lstatSync(fullPath)
          if (lstat.isSymbolicLink()) {
            isSymlink = true
            symlinkTarget = fs.readlinkSync(fullPath)
          }
        } catch {
          // ignore
        }

        const skillMd = path.join(fullPath, 'SKILL.md')
        if (fs.existsSync(skillMd)) {
          try {
            const rawContent = fs.readFileSync(skillMd, 'utf-8')
            const { meta } = parseFrontmatter(rawContent)
            const name = meta.name || entry.name
            const description = meta.description || meta.summary || ('Skill ' + entry.name)
            const lockItem = lockInfo[entry.name]
            let category = this.category
            if (isSymlink) category = 'symlink'

            skills.push({
              id: entry.name,
              name,
              description: description.replace(/\r?\n/g, ' ').trim(),
              platform: this.platform,
              platformName: this.platformName,
              category,
              rawLocation: skillMd,
              skillDir: fullPath,
              isSymlink,
              symlinkTarget,
              isBuiltin: this.isBuiltin,
              version: lockItem?.version,
              sourceUrl: lockItem?.sourceUrl,
              tags: extractSkillTags(name, description)
            })
          } catch (err) {
            console.error(`[DirectorySkillProvider:${this.platform}] Failed reading skill ${skillMd}:`, err)
          }
        }
      }
    } catch (e) {
      console.error(`[DirectorySkillProvider:${this.platform}] Failed reading directory ${this.dir}:`, e)
    }

    return skills
  }
}
