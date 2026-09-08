import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { SkillProvider } from './base-skill-provider'
import { extractSkillTags } from './base-skill-provider'
import type { UnifiedSkill } from '../skill-types'

export class ClaudePluginSkillProvider implements SkillProvider {
  readonly platform = 'claude'
  readonly platformName = 'Claude Code'
  readonly pluginFile = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json')

  isAvailable(): boolean {
    return fs.existsSync(this.pluginFile)
  }

  getSkills(): UnifiedSkill[] {
    if (!this.isAvailable()) return []

    const skills: UnifiedSkill[] = []
    try {
      const pluginData = JSON.parse(fs.readFileSync(this.pluginFile, 'utf-8'))
      const plugins = pluginData.plugins || {}

      for (const [pKey, pList] of Object.entries(plugins)) {
        const list = pList
        if (Array.isArray(list) && list.length > 0) {
          const pInfo = (list[0] || {}) as { installPath?: string, version?: string }
          const name = pKey.split('@')[0] || pKey
          const installPath = pInfo.installPath || ''
          const readmePath = path.join(installPath, 'README.md')
          let description = 'Claude Plugin: ' + name

          if (fs.existsSync(readmePath)) {
            try {
              const readme = fs.readFileSync(readmePath, 'utf-8')
              const firstLine = readme.split('\n').find(l => l.trim().length > 0 && !l.startsWith('#'))
              if (firstLine) description = firstLine.trim()
            } catch {
              // ignore
            }
          }

          skills.push({
            id: name,
            name,
            description,
            platform: this.platform,
            platformName: this.platformName,
            category: 'plugin',
            rawLocation: fs.existsSync(readmePath) ? readmePath : installPath,
            skillDir: installPath,
            isSymlink: false,
            isBuiltin: false,
            version: pInfo.version,
            tags: extractSkillTags(name, description)
          })
        }
      }
    } catch (e) {
      console.error('[ClaudePluginSkillProvider] Failed reading claude plugins:', e)
    }

    return skills
  }
}
