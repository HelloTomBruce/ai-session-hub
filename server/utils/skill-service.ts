import { skillRegistry } from './skill-providers/skill-provider-registry'
import type { UnifiedSkill, SkillDetailResponse, SkillStats } from './skill-types'

export class SkillService {
  getAllSkills(platformFilter?: string, query?: string): { skills: UnifiedSkill[], stats: Record<string, number>, total: number } {
    return skillRegistry.getAllSkills(platformFilter, query)
  }

  getSkillDetail(platform: string, id: string): SkillDetailResponse | null {
    return skillRegistry.getSkillDetail(platform, id)
  }

  getStats(): SkillStats {
    return skillRegistry.getStats()
  }
}

export const skillService = new SkillService()
export * from './skill-types'
export { skillRegistry } from './skill-providers/skill-provider-registry'
export { DirectorySkillProvider, type SkillProvider } from './skill-providers/directory-skill-provider'
