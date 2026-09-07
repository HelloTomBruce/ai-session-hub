export interface PlatformMeta {
  id: string
  name: string
  category: 'cli' | 'app' | 'universal' | 'builtin'
  icon: string
  color: string
  badgeBg: string
  description: string
  hasSessions: boolean
  hasSkills: boolean
  hasMcp: boolean
  configPaths?: {
    sessions?: string
    skills?: string
    mcp?: string
  }
}

export const PLATFORMS_META: Record<string, PlatformMeta> = {
  agents: {
    id: 'agents',
    name: '全局通用 (~/.agents)',
    category: 'universal',
    icon: 'i-heroicons-globe-alt',
    color: 'text-amber-400',
    badgeBg: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    description: '多 Agent CLI/App 共享的通用技能库与环境配置',
    hasSessions: false,
    hasSkills: true,
    hasMcp: false,
    configPaths: {
      skills: '~/.agents/skills'
    }
  },
  pi: {
    id: 'pi',
    name: 'Pi CLI',
    category: 'cli',
    icon: 'i-heroicons-command-line',
    color: 'text-emerald-400',
    badgeBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    description: '轻量级多模型终端 Agent，支持树状会话、Skill 与 MCP 工具',
    hasSessions: true,
    hasSkills: true,
    hasMcp: true,
    configPaths: {
      sessions: '~/.pi/agent/sessions/',
      skills: '~/.pi/agent/skills/',
      mcp: '~/.pi/agent/mcp.json'
    }
  },
  claude: {
    id: 'claude',
    name: 'Claude Code',
    category: 'cli',
    icon: 'i-heroicons-sparkles',
    color: 'text-orange-400',
    badgeBg: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    description: 'Anthropic 官方研究级 Coding CLI，支持项目级会话、MCP 与 Plugins',
    hasSessions: true,
    hasSkills: true,
    hasMcp: true,
    configPaths: {
      sessions: '~/.claude/projects/',
      skills: '~/.claude/plugins/installed_plugins.json',
      mcp: '~/.claude.json'
    }
  },
  codex: {
    id: 'codex',
    name: 'Codex App',
    category: 'app',
    icon: 'i-heroicons-bolt',
    color: 'text-violet-400',
    badgeBg: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    description: '基于 SQLite 架构的高性能本地智能开发会话环境与系统技能',
    hasSessions: true,
    hasSkills: true,
    hasMcp: false,
    configPaths: {
      sessions: '~/.codex/sessions.db',
      skills: '~/.codex/skills/'
    }
  },
  agy: {
    id: 'agy',
    name: 'AGY CLI (Antigravity)',
    category: 'cli',
    icon: 'i-heroicons-cpu-chip',
    color: 'text-sky-400',
    badgeBg: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    description: '深度推理编码 Agent，支持 Brain 轨迹、Builtin/Custom 技能与 MCP Schema',
    hasSessions: true,
    hasSkills: true,
    hasMcp: true,
    configPaths: {
      sessions: '~/.gemini/antigravity-cli/brain/',
      skills: '~/.gemini/antigravity-cli/skills/',
      mcp: '~/.gemini/antigravity-cli/mcp/'
    }
  },
  workbuddy: {
    id: 'workbuddy',
    name: 'WorkBuddy',
    category: 'app',
    icon: 'i-heroicons-briefcase',
    color: 'text-blue-400',
    badgeBg: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    description: '企业级工作助手，支持本地知识库、MCP 工具服务与专属技能',
    hasSessions: true,
    hasSkills: true,
    hasMcp: true,
    configPaths: {
      sessions: '~/.workbuddy/sessions.db',
      skills: '~/.workbuddy/skills/',
      mcp: '~/.workbuddy/mcp.json'
    }
  },
  reasonix: {
    id: 'reasonix',
    name: 'Reasonix',
    category: 'cli',
    icon: 'i-heroicons-variable',
    color: 'text-pink-400',
    badgeBg: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
    description: '多步逻辑推演与形式化验证 CLI 工具，基于 TOML 配置与专属插件',
    hasSessions: true,
    hasSkills: true,
    hasMcp: true,
    configPaths: {
      sessions: '~/.reasonix/sessions/',
      skills: '~/.reasonix/skills/',
      mcp: '~/.reasonix/config.toml'
    }
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    category: 'cli',
    icon: 'i-heroicons-code-bracket-square',
    color: 'text-teal-400',
    badgeBg: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
    description: '开放架构开源智能开发 CLI，支持标准 JSON 配置、技能与 MCP 接入',
    hasSessions: true,
    hasSkills: true,
    hasMcp: true,
    configPaths: {
      sessions: '~/.config/opencode/sessions.json',
      skills: '~/.config/opencode/skills/',
      mcp: '~/.config/opencode/opencode.json'
    }
  },
  hub: {
    id: 'hub',
    name: 'Session Hub (内置)',
    category: 'builtin',
    icon: 'i-heroicons-square-3-stack-3d',
    color: 'text-purple-400',
    badgeBg: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    description: 'AI Session Hub 本地内置 MCP SSE 服务与跨端知识中枢',
    hasSessions: false,
    hasSkills: false,
    hasMcp: true,
    configPaths: {
      mcp: 'http://localhost:3000/api/mcp/sse'
    }
  }
}

export function getPlatformMeta(platform: string): PlatformMeta {
  return PLATFORMS_META[platform] || {
    id: platform,
    name: platform.toUpperCase(),
    category: 'cli',
    icon: 'i-heroicons-cube',
    color: 'text-neutral-400',
    badgeBg: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20',
    description: '第三方智能开发工具',
    hasSessions: true,
    hasSkills: false,
    hasMcp: false
  }
}
