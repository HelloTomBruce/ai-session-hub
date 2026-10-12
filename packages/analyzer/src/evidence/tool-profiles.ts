/**
 * 各平台工具识别档案（平台无关证据归一化的单一事实源）。
 * 插件自身最了解自己的工具名；默认档案覆盖通用命名。
 * 未来可由 packages/core 的 PluginToolProfile descriptor 注入覆盖。
 */

export type ToolKind = 'edit' | 'shell' | 'search-read' | 'other'

export interface ToolProfile {
  edit: RegExp[]
  shell: RegExp[]
  read: RegExp[]
}

const GENERIC_EDIT = [
  /(^|[_:-])(write|create|new)([_:-]|$)/i,
  /(edit|replace|modify|update|patch|str[_-]?replace|insert)/i
]
const GENERIC_SHELL = [/^(bash|sh|shell|terminal|console|command)$/i, /(exec|run)_?(command|cmd|shell)?/i]
const GENERIC_READ = [
  /^(read|view|cat|show|open|list|ls|dir)$/i,
  /(grep|search|find|glob|scan|query|list_dir|view_file|read_file|read_file_chunk)/i
]

export const TOOL_PROFILES: Record<string, ToolProfile> = {
  claude: {
    edit: [/^apply_patch$/i, /^str_replace$/i, /^write$/i, /^edit$/i, /^notebook_edit$/i, /^create_file$/i, /^multi_edit$/i],
    shell: [/^bash$/i],
    read: [/^(read|grep|glob|todo|task)$/i, /list|search/]
  },
  codex: {
    edit: [/apply_patch/i, /^update_file$/i, /^create_file$/i, /str_replace/i, /patch/i],
    shell: [/^(shell|local_shell|exec)$/i, /exec_command/i],
    read: GENERIC_READ
  },
  opencode: {
    edit: [/^(edit|write)$/i, /str_replace|patch|replace/i],
    shell: [/^(bash|shell|terminal)$/i],
    read: GENERIC_READ
  },
  agy: {
    edit: GENERIC_EDIT.concat([/patch/i]),
    shell: GENERIC_SHELL,
    read: GENERIC_READ
  },
  workbuddy: {
    edit: GENERIC_EDIT,
    shell: GENERIC_SHELL,
    read: GENERIC_READ
  },
  zcode: {
    edit: GENERIC_EDIT.concat([/patch/i]),
    shell: GENERIC_SHELL,
    read: GENERIC_READ
  },
  pi: {
    edit: GENERIC_EDIT,
    shell: GENERIC_SHELL,
    read: GENERIC_READ
  }
}

export const DEFAULT_TOOL_PROFILE: ToolProfile = {
  edit: GENERIC_EDIT.concat([/apply_patch/i]),
  shell: GENERIC_SHELL,
  read: GENERIC_READ
}

export function getToolProfile(platform?: string): ToolProfile {
  return (platform && TOOL_PROFILES[platform]) || DEFAULT_TOOL_PROFILE
}

export function classifyTool(rawName: string, profile: ToolProfile): ToolKind {
  const name = (rawName || '').toLowerCase()
  if (!name) return 'other'
  if (profile.edit.some(re => re.test(name))) return 'edit'
  if (profile.shell.some(re => re.test(name))) return 'shell'
  if (profile.read.some(re => re.test(name))) return 'search-read'
  return 'other'
}
