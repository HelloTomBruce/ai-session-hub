import { mcpLogger } from '../../mcp-logger'
import { memoryService } from '../../memory-service'
import type { ProblemEntity, ProjectEntity, TechConceptEntity } from '../../memory-types'

import type { McpToolDefinition } from '../tool-types'

export const SaveMemoryTool: McpToolDefinition = {
  name: 'save_memory',
  description: '将当前对话中提炼的高价值架构决策、排坑避坑指南或最佳实践主动沉淀到 Grafeo 记忆图谱中（解耦会话存续，永久保留）。走统一去重管线：同源会话/同标题高相似度原地更新，内容演进自动建 SUPERSEDES 链',
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: '记忆/经验标题'
      },
      type: {
        type: 'string',
        description: '记忆分类（如 ADR, Gotcha, BestPractice, Pattern, Workflow, Config 或自定义）'
      },
      summary: {
        type: 'string',
        description: '一句话核心摘要'
      },
      content: {
        type: 'string',
        description: '详细方案、原理、操作步骤或完整 Markdown 报告'
      },
      projects: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            cwd: { type: 'string' }
          },
          required: ['name']
        },
        description: '适用的项目列表'
      },
      techConcepts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            category: { type: 'string' }
          },
          required: ['name']
        },
        description: '涉及的技术栈/工具/库列表'
      },
      problems: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            symptom: { type: 'string' },
            errorCode: { type: 'string' }
          },
          required: ['title']
        },
        description: '解决的痛点/报错/异常'
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '关联标签'
      },
      supersededIds: {
        type: 'array',
        items: { type: 'string' },
        description: '被本记忆演进替代的旧记忆 id 数组（建立 SUPERSEDES 链，旧节点自动退出召回）'
      }
    },
    required: ['title', 'content']
  },
  async handler({ args, name, startTime }) {
    const title = (args.title as string) || '未命名记忆'
    const type = (args.type as string) || 'BestPractice'
    const summary = (args.summary as string) || title
    const content = (args.content as string) || ''
    const tags = (args.tags as string[]) || []
    const projects = (args.projects as ProjectEntity[]) || []
    const techConcepts = (args.techConcepts as TechConceptEntity[]) || []
    const problems = (args.problems as ProblemEntity[]) || []
    const supersededIds = (args.supersededIds as string[]) || []

    // P1 统一去重管线：与评估沉淀/手动提炼/capture_session_insight 同一入口
    const { item: saved, dedup } = await memoryService.saveMemoryWithDedup({
      title,
      type,
      summary,
      content,
      tags,
      projects,
      techConcepts,
      problems,
      supersededIds
    })

    mcpLogger.addLog({
      type: 'tool',
      name,
      params: args,
      status: 'success',
      durationMs: Date.now() - startTime,
      responsePreview: `Saved memory ${saved.id} into Grafeo graph (dedup=${dedup})`
    })

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: '记忆与实体拓扑已成功持久化至 Grafeo 图数据库',
              dedup,
              item: saved
            },
            null,
            2
          )
        }
      ]
    }
  }
}
