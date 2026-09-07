export type PlatformSkillSource = 'all' | 'agents' | 'pi' | 'codex' | 'agy' | 'workbuddy' | 'reasonix' | 'opencode' | 'claude'

export interface UnifiedSkill {
  id: string
  name: string
  description: string
  platform: string
  platformName: string
  category: 'universal' | 'system' | 'custom' | 'symlink' | 'plugin'
  rawLocation: string
  skillDir: string
  isSymlink: boolean
  symlinkTarget?: string
  isBuiltin?: boolean
  version?: string
  sourceUrl?: string
  tags?: string[]
  enabledIn?: string[]
}

export interface SkillDetailResponse {
  skill: UnifiedSkill
  readmeContent: string
  files: string[]
}

export interface SkillStats {
  total: number
  universalCount: number
  counts: Record<string, number>
}
