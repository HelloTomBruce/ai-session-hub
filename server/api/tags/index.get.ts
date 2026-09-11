export default defineEventHandler(() => {
  return {
    success: true,
    data: tagService.getAllTags()
  }
})
