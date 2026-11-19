import test from 'node:test'
import assert from 'node:assert/strict'

// validate.ts 用 Nitro 自动导入的 createError；单测里把它 stub 成带 statusCode 的普通 Error
;

(globalThis as Record<string, unknown>).createError = (opts: { statusCode: number, message: string }) => {
  const err = new Error(opts.message) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
}

const {
  requireString,
  optionalString,
  requireStringArray,
  requireInt,
  optionalBool,
  requireEntityRefs
} = await import('../../server/utils/validate')

/** 断言某个校验器以 400 拒绝 */
function expect400(fn: () => unknown, keyword?: RegExp) {
  try {
    fn()
  } catch (err) {
    const e = err as { statusCode?: number, message?: string }
    assert.equal(e.statusCode, 400, `期望 400，实际 ${e.statusCode}`)
    if (keyword) assert.match(e.message || '', keyword)
    return
  }
  assert.fail('期望抛出 400，但调用成功了')
}

test('requireString：类型 / 长度 / 枚举', () => {
  assert.equal(requireString('  hi  ', { field: 'title' }), 'hi')
  expect400(() => requireString(123, { field: 'title' }), /title/)
  expect400(() => requireString('', { field: 'title', min: 1 }), /title/)
  expect400(() => requireString('x'.repeat(11), { field: 'title', max: 10 }), /10/)
  expect400(() => requireString('nope', { field: 'mode', oneOf: ['add', 'set'] }), /add/)
})

test('optionalString：缺省与空串返回 undefined', () => {
  assert.equal(optionalString(undefined, { field: 'q' }), undefined)
  assert.equal(optionalString('', { field: 'q' }), undefined)
  assert.equal(optionalString(' v ', { field: 'q' }), 'v')
})

test('requireStringArray：去重、上限、元素类型', () => {
  assert.deepEqual(requireStringArray(['a', 'a', 'b'], { field: 'tags' }), ['a', 'b'])
  expect400(() => requireStringArray('a', { field: 'tags' }), /数组/)
  expect400(() => requireStringArray([1], { field: 'tags' }), /tags/)
  expect400(() => requireStringArray(['a', 'b', 'c'], { field: 'tags', maxItems: 2 }), /最多 2/)
})

test('requireInt：范围与 fallback', () => {
  assert.equal(requireInt('42', { field: 'limit' }), 42)
  assert.equal(requireInt(undefined, { field: 'limit', fallback: 200 }), 200)
  expect400(() => requireInt('abc', { field: 'limit' }), /整数/)
  expect400(() => requireInt(1.5, { field: 'limit' }), /整数/)
  expect400(() => requireInt(0, { field: 'limit', min: 1 }), /不能小于/)
  expect400(() => requireInt(999, { field: 'limit', max: 100 }), /不能大于/)
})

test('optionalBool：布尔与字符串布尔', () => {
  assert.equal(optionalBool('true', 'force'), true)
  assert.equal(optionalBool('false', 'force'), false)
  assert.equal(optionalBool(1, 'force'), true)
  assert.equal(optionalBool(undefined, 'force'), undefined)
  expect400(() => optionalBool('yes', 'force'), /布尔/)
})

test('requireEntityRefs：批量操作入参形状', () => {
  assert.deepEqual(
    requireEntityRefs([{ id: 'a', cli: 'pi' }], { field: 'items' }),
    [{ id: 'a', cli: 'pi' }]
  )
  expect400(() => requireEntityRefs([{ id: 'a' }], { field: 'items' }), /cli/)
  expect400(() => requireEntityRefs('x', { field: 'items' }), /数组/)
  expect400(() => requireEntityRefs([null], { field: 'items' }), /对象/)
})
