import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { buildFtsQuery } from './fts-query'

/**
 * TOMB-20：FTS 查询转义缺陷回归测试
 *
 * 背景：unicode61 分词器下 `-` / `.` / `@` 不是 token 字符，
 * 旧实现对含这些字符的 token 直接拼 `*` 前缀，产生非法 FTS5 语法，
 * 错误被吞掉后整类查询（文件名/路径/版本号/邮箱）静默 0 命中。
 */

describe('buildFtsQuery token 形态', () => {
  it('纯 ASCII 词 -> 前缀查询', () => {
    expect(buildFtsQuery('cache')).toBe('cache*')
    expect(buildFtsQuery('user_id')).toBe('user_id*')
  })

  it('连字符词不产生裸 * 拼接', () => {
    const q = buildFtsQuery('project-alpha')
    expect(q).not.toMatch(/[a-z]-[a-z]+\*/)
    expect(q).toContain('project*')
    expect(q).toContain('alpha*')
  })

  it('点分隔 token（文件名/版本号）走双引号短语', () => {
    expect(buildFtsQuery('node.js')).toBe('"node.js"')
    expect(buildFtsQuery('v1.2.3')).toBe('"v1.2.3"')
    expect(buildFtsQuery('cache-service.ts')).toBe('cache* "service.ts"')
  })

  it('邮箱地址：本地部分前缀 + 域名短语', () => {
    const q = buildFtsQuery('zhang@example.com')
    expect(q).toContain('zhang*')
    expect(q).toContain('"example.com"')
  })

  it('中文 token 走双引号短语', () => {
    expect(buildFtsQuery('你好')).toBe('"你好"')
  })

  it('中英混合查询', () => {
    const q = buildFtsQuery('部署 pipeline')
    expect(q).toBe('"部署" pipeline*')
  })

  it('OR 在两侧有操作数时保留为运算符', () => {
    expect(buildFtsQuery('hello OR world')).toBe('hello* OR world*')
  })

  it('OR/AND/NOT 缺少操作数时降级为字面量短语', () => {
    expect(buildFtsQuery('OR')).toBe('"OR"')
    expect(buildFtsQuery('OR hello')).toBe('"OR" hello*')
    expect(buildFtsQuery('hello AND')).toBe('hello* "AND"')
    expect(buildFtsQuery('NOT')).toBe('"NOT"')
  })

  it('双引号被正确转义（防注入）', () => {
    const q = buildFtsQuery('" OR 1=1')
    // 不应出现未转义的裸引号破坏语法
    expect(q.split('"').length % 2).toBe(1)
  })

  it('纯标点/符号输入返回空串', () => {
    expect(buildFtsQuery('-')).toBe('')
    expect(buildFtsQuery('...')).toBe('')
    expect(buildFtsQuery(' @ ')).toBe('')
    expect(buildFtsQuery('')).toBe('')
    expect(buildFtsQuery('   ')).toBe('')
  })
})

describe('buildFtsQuery 语法合法性 + 召回（真实 FTS5 / unicode61）', () => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='unicode61');
    INSERT INTO docs(content) VALUES
      ('working on project-alpha branch today'),
      ('use node.js runtime for the server'),
      ('release v1.2.3 is out'),
      ('the foo-bar component renders'),
      ('contact zhang@example.com for access'),
      ('hello there'),
      ('world peace'),
      ('修改 cache-service.ts 中的检索逻辑'),
      ('部署 pipeline 在 pnpm install 阶段超时');
  `)
  const match = (query: string): string[] => {
    const fts = buildFtsQuery(query)
    if (!fts) return []
    return (db.prepare('SELECT content FROM docs WHERE docs MATCH ?').all(fts) as Array<{ content: string }>).map(r => r.content)
  }

  it('所有生成的查询都是合法 FTS5 语法（不抛错）', () => {
    const queries = [
      'project-alpha', 'node.js', 'v1.2.3', 'foo-bar', 'zhang@example.com',
      'hello OR world', 'OR', 'AND NOT', '" OR 1=1', 'C++', 'cache-service.ts',
      '你好 world', '部署 pipeline', '-', '***', 'a/b/c', 'NEAR(foo bar)',
      'title:hello', '(unclosed', '你好"world'
    ]
    for (const q of queries) {
      expect(() => match(q), `query: ${q}`).not.toThrow()
    }
  })

  it('连字符词召回', () => {
    expect(match('project-alpha')).toContain('working on project-alpha branch today')
    expect(match('foo-bar')).toContain('the foo-bar component renders')
  })

  it('点分隔召回（文件名/版本号）', () => {
    expect(match('node.js')).toContain('use node.js runtime for the server')
    expect(match('v1.2.3')).toContain('release v1.2.3 is out')
    expect(match('cache-service.ts')).toContain('修改 cache-service.ts 中的检索逻辑')
  })

  it('邮箱召回', () => {
    expect(match('zhang@example.com')).toContain('contact zhang@example.com for access')
  })

  it('OR 组合查询召回两侧', () => {
    const hits = match('hello OR world')
    expect(hits).toContain('hello there')
    expect(hits).toContain('world peace')
  })

  it('AND 组合查询', () => {
    const hits = match('hello AND there')
    expect(hits).toEqual(['hello there'])
  })

  it('中英混合召回', () => {
    expect(match('部署 pipeline')).toContain('部署 pipeline 在 pnpm install 阶段超时')
  })

  it('注入形态不报错且不全量命中', () => {
    const hits = match('" OR 1=1')
    expect(hits.length).toBe(0)
  })
})
