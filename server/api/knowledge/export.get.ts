import { knowledgeService } from '../../utils/knowledge-service'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const idsParam = query.ids ? String(query.ids).split(',') : undefined
  const type = query.type ? String(query.type) : undefined

  const markdown = knowledgeService.exportMarkdown(idsParam, type)

  setResponseHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setResponseHeader(event, 'Content-Disposition', 'attachment; filename="knowledge-vault-export.md"')

  return markdown
})
