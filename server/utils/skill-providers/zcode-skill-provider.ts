import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { SkillProvider } from './base-skill-provider'
import { parseFrontmatter, extractSkillTags } from './base-skill-provider'
import type { UnifiedSkill } from '../skill-types'

export class ZCodeSkillProvider implements SkillProvider {
  readonly platform = 'zcode'
  readonly platformName = 'ZCode'
  private pluginsCacheDir: string
  private customSkillsDir: string

  constructor() {
    const home = os.homedir()
    this.pluginsCacheDir = path.join(home, '.zcode', 'cli', 'plugins', 'cache', 'zcode-plugins-official')
    this.customSkillsDir = path.join(home, '.zcode', 'skills')
  }

  isAvailable(): boolean {
    return fs.existsSync(this.pluginsCacheDir) || fs.existsSync(this.customSkillsDir)
  }

  getSkills(): UnifiedSkill[] {
    const skills: UnifiedSkill[] = []
    const seenIds = new Set<string>()

    // 1. Scan custom skills in ~/.zcode/skills if exists
    if (fs.existsSync(this.customSkillsDir)) {
      try {
        const entries = fs.readdirSync(this.customSkillsDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
          const skillDir = path.join(this.customSkillsDir, entry.name)
          const skillMdPath = path.join(skillDir, 'SKILL.md')
          if (fs.existsSync(skillMdPath)) {
            try {
              const content = fs.readFileSync(skillMdPath, 'utf-8')
              const { meta } = parseFrontmatter(content)
              const id = meta.name || entry.name
              const name = meta.name || entry.name
              const description = meta.description || `ZCode 自定义技能: ${name}`

              if (!seenIds.has(id)) {
                seenIds.add(id)
                skills.push({
                  id,
                  name,
                  description,
                  platform: this.platform,
                  platformName: this.platformName,
                  category: 'custom',
                  rawLocation: skillMdPath,
                  skillDir,
                  isSymlink: entry.isSymbolicLink(),
                  isBuiltin: false,
                  tags: extractSkillTags(name, description)
                })
              }
            } catch {
              // ignore malformed skill
            }
          }
        }
      } catch (e) {
        console.error('[ZCodeSkillProvider] Failed scanning custom skills:', e)
      }
    }

    // 2. Scan official cached plugins in ~/.zcode/cli/plugins/cache/zcode-plugins-official
    if (fs.existsSync(this.pluginsCacheDir)) {
      try {
        const pluginDirs = fs.readdirSync(this.pluginsCacheDir, { withFileTypes: true })
        for (const pDir of pluginDirs) {
          if (!pDir.isDirectory()) continue
          const pPath = path.join(this.pluginsCacheDir, pDir.name)
          // Look into version subdirectories
          const versions = fs.readdirSync(pPath, { withFileTypes: true })
          for (const vDir of versions) {
            if (!vDir.isDirectory()) continue
            const skillsSubdir = path.join(pPath, vDir.name, 'skills')
            if (fs.existsSync(skillsSubdir)) {
              try {
                const sEntries = fs.readdirSync(skillsSubdir, { withFileTypes: true })
                for (const sEntry of sEntries) {
                  if (!sEntry.isDirectory()) continue
                  const skillDir = path.join(skillsSubdir, sEntry.name)
                  const skillMdPath = path.join(skillDir, 'SKILL.md')
                  if (fs.existsSync(skillMdPath)) {
                    try {
                      const content = fs.readFileSync(skillMdPath, 'utf-8')
                      const { meta } = parseFrontmatter(content)
                      const id = `zcode:${pDir.name}:${meta.name || sEntry.name}`
                      const name = meta.name || sEntry.name
                      const description = meta.description || `ZCode 插件技能 [${pDir.name}]: ${name}`

                      if (!seenIds.has(id)) {
                        seenIds.add(id)
                        skills.push({
                          id,
                          name,
                          description,
                          platform: this.platform,
                          platformName: this.platformName,
                          category: 'plugin',
                          rawLocation: skillMdPath,
                          skillDir,
                          isSymlink: false,
                          isBuiltin: true,
                          version: vDir.name,
                          tags: extractSkillTags(name, description)
                        })
                      }
                    } catch {
                      // ignore
                    }
                  }
                }
              } catch {
                // ignore
              }
            }
          }
        }
      } catch (e) {
        console.error('[ZCodeSkillProvider] Failed scanning plugin skills:', e)
      }
    }

    return skills
  }
}
