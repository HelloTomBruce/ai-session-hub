export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body || !body.cli) {
    throw createError({ statusCode: 400, message: 'CLI type is required' })
  }

  const session = createCliSession(body.cli as CliType, {
    title: body.title,
    cwd: body.cwd,
    initialPrompt: body.initialPrompt
  })

  return {
    success: true,
    data: session
  }
})
