import os from 'node:os'
import type { UnifiedSkill } from '../skill-types'

const homeDir = os.homedir()

export interface SkillProvider {
  readonly platform: string
  readonly platformName: string
  isAvailable(): boolean
  getSkills(): UnifiedSkill[]
}

export function parseFrontmatter(content: string): { meta: Record<string, string>, body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match || !match[1]) return { meta: {}, body: content }
  const yamlBlock = match[1]
  const body = content.slice(match[0].length).trim()
  const meta: Record<string, string> = {}

  let currentKey: string | null = null
  let currentValue = ''

  for (const line of yamlBlock.split('\n')) {
    const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/)
    if (keyMatch && keyMatch[1]) {
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

export function extractSkillTags(name: string, description: string): string[] {
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
