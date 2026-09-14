import { evaluateSessionValue, type EvaluationContext } from '../server/utils/evaluator-engine'

async function runTests() {
  console.log('=== 开始量化评估引擎单元测试 ===\n')

  // Case 1: 重大架构改造 (ADR 预期)
  const adrContext: EvaluationContext = {
    sessionId: 'sess_adr_001',
    platform: 'agy',
    title: '重构并统一 11 个平台的会话适配层为统一缓存接口',
    cwd: '/Users/zhangbei/code/session-hub',
    messages: [
      {
        role: 'user',
        content: '现在的各适配器逻辑混乱，需要抽象出一个 BaseSqliteAdapter 基类，并定义统一的接口'
      },
      {
        role: 'assistant',
        thought: '权衡分析：如果使用继承抽象基类模式，可以复用统一的 SQLite 连接池和异常处理机制。方案对比：比每个平台独立写重复的 SQL 语句更加健壮，避免了代码冗余。选型决定：创建 BaseSqliteAdapter 并让各个平台继承它。',
        content: '我已经完成了 BaseSqliteAdapter 的抽象与所有 11 个适配器的重构。',
        toolCalls: [
          {
            name: 'write_to_file',
            arguments: {
              TargetFile: 'server/utils/base-sqlite-adapter.ts',
              CodeContent: 'export abstract class BaseSqliteAdapter implements ISessionAdapter { abstract query(): Promise<void>; }'
            }
          },
          {
            name: 'edit_file',
            arguments: {
              TargetFile: 'server/utils/adapters/cursor-adapter.ts',
              ReplacementContent: 'export class CursorAdapter extends BaseSqliteAdapter { ... }'
            }
          },
          {
            name: 'edit_file',
            arguments: {
              TargetFile: 'server/utils/adapters/kimi-adapter.ts',
              ReplacementContent: 'export class KimiAdapter extends BaseSqliteAdapter { ... }'
            }
          }
        ]
      }
    ],
    gitDiffs: [
      {
        filePath: 'server/utils/base-sqlite-adapter.ts',
        patch: 'export abstract class BaseSqliteAdapter implements ISessionAdapter { ... }',
        addedLines: 80,
        deletedLines: 0
      },
      {
        filePath: 'server/utils/adapters/cursor-adapter.ts',
        patch: 'export class CursorAdapter extends BaseSqliteAdapter',
        addedLines: 20,
        deletedLines: 60
      }
    ]
  }

  // Case 2: 疑难杂症排障与踩坑 (Gotcha 预期)
  const gotchaContext: EvaluationContext = {
    sessionId: 'sess_gotcha_002',
    platform: 'claude',
    title: '排查 @nuxt/fonts 在内网环境下的 10s 超时报错',
    cwd: '/Users/zhangbei/code/session-hub',
    messages: [
      {
        role: 'user',
        content: '启动报错：Connect Timeout Error (attempted addresses: 142.251.170.138:443)'
      },
      {
        role: 'assistant',
        thought: '根本原因分析：@nuxt/fonts 底层使用 undici 默认拉取 Google Fonts 元数据，国内网络无法直连导致超时。避坑注意点：必须在 nuxt.config.ts 中配置 providers.google: false 禁用远程拉取，使用本地系统字体。',
        content: '通过在 nuxt.config.ts 中关闭 google 和 googleicons 供应商，已彻底解决超时阻塞问题。',
        toolCalls: [
          {
            name: 'replace_file_content',
            arguments: {
              TargetFile: 'nuxt.config.ts',
              ReplacementContent: 'fonts: { providers: { google: false, googleicons: false } }'
            }
          }
        ]
      }
    ],
    gitDiffs: [
      {
        filePath: 'nuxt.config.ts',
        patch: 'try { fonts: { providers: { google: false } } } catch (e) {}',
        addedLines: 8,
        deletedLines: 0
      }
    ]
  }

  // Case 3: 琐碎日常改动 (Trivial / 过滤预期)
  const trivialContext: EvaluationContext = {
    sessionId: 'sess_trivial_003',
    platform: 'cursor',
    title: '调整按钮的文案与右边距',
    cwd: '/Users/zhangbei/code/session-hub',
    messages: [
      {
        role: 'user',
        content: '把保存按钮的名字改成提交，padding 加 2px'
      },
      {
        role: 'assistant',
        thought: '修改按钮文案和样式。',
        content: '已将“保存”改为“提交”。',
        toolCalls: [
          {
            name: 'replace_file_content',
            arguments: {
              TargetFile: 'app/components/Button.vue',
              ReplacementContent: '<button class="p-2">提交</button>'
            }
          }
        ]
      }
    ]
  }

  // Case 4: 思维链空转膨胀与盲搜卡死 (Thrashing & Tool Friction Stall)
  const stallContext: EvaluationContext = {
    sessionId: 'sess_stall_004',
    platform: 'agy',
    title: '尝试连接 UI 与拓扑视图但因工具报错卡死',
    cwd: '/Users/zhangbei/code/session-hub',
    messages: [
      {
        role: 'user',
        content: '帮我实现拓扑网络连线'
      },
      {
        role: 'assistant',
        // 模拟长达数万字的死循环重复思考
        thought: '思考1: 尝试搜索... 搜索失败... 再次尝试... ' + '不断重试错误方案... '.repeat(1500),
        content: '工具调用出错，未能定位到相关节点，任务停滞。',
        toolCalls: Array.from({ length: 47 }, (_, i) => ({
          name: i % 2 === 0 ? 'grep_search' : 'list_dir',
          arguments: { Query: `test_${i}` }
        }))
      }
    ],
    gitDiffs: [
      {
        filePath: 'app/pages/test.vue',
        patch: '<div>未完成修改</div>',
        addedLines: 2,
        deletedLines: 0
      }
    ]
  }

  const report1 = await evaluateSessionValue(adrContext)
  console.log('[测试 1 - 架构重构]:')
  console.log(`- 综合得分: ${report1.overallScore} | 等级: ${report1.grade} | 分类: ${report1.category}`)
  console.log(`- 子项得分: AST=${report1.subScores.astImpact}, Entropy=${report1.subScores.informationDensity}, Topology=${report1.subScores.topologyCentrality}`)
  console.log(`- 是否值得保存: ${report1.isWorthSaving} | 推荐动作: ${report1.suggestedAction}`)
  console.log(`- 判定原因: ${report1.summaryReason}\n`)

  const report2 = await evaluateSessionValue(gotchaContext)
  console.log('[测试 2 - 踩坑排障]:')
  console.log(`- 综合得分: ${report2.overallScore} | 等级: ${report2.grade} | 分类: ${report2.category}`)
  console.log(`- 子项得分: AST=${report2.subScores.astImpact}, Entropy=${report2.subScores.informationDensity}, Topology=${report2.subScores.topologyCentrality}`)
  console.log(`- 是否值得保存: ${report2.isWorthSaving} | 推荐动作: ${report2.suggestedAction}`)
  console.log(`- 判定原因: ${report2.summaryReason}\n`)

  const report3 = await evaluateSessionValue(trivialContext)
  console.log('[测试 3 - 琐碎改动]:')
  console.log(`- 综合得分: ${report3.overallScore} | 等级: ${report3.grade} | 分类: ${report3.category}`)
  console.log(`- 是否值得保存: ${report3.isWorthSaving} | 推荐动作: ${report3.suggestedAction}`)
  console.log(`- 判定原因: ${report3.summaryReason}\n`)

  const report4 = await evaluateSessionValue(stallContext)
  console.log('[测试 4 - 空转与未闭环会话 (Thrashing & Tool Stall)]:')
  console.log(`- 综合得分: ${report4.overallScore} | 等级: ${report4.grade} | 分类: ${report4.category}`)
  console.log(`- 子项得分: AST=${report4.subScores.astImpact}, Entropy=${report4.subScores.informationDensity}, Topology=${report4.subScores.topologyCentrality}`)
  console.log(`- 是否值得保存: ${report4.isWorthSaving} | 推荐动作: ${report4.suggestedAction}`)
  console.log(`- 判定原因: ${report4.summaryReason}\n`)

  console.log('=== 验证断言 ===')
  const pass1 = report1.isWorthSaving && report1.category === 'ADR'
  const pass2 = report2.isWorthSaving && (report2.category === 'Gotcha' || report2.category === 'Pattern')
  const pass3 = !report3.isWorthSaving && report3.category === 'Trivial'
  const pass4 = !report4.isWorthSaving && report4.category === 'Trivial'

  console.log(`用例 1 (ADR 识别): ${pass1 ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`用例 2 (Gotcha 识别): ${pass2 ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`用例 3 (Trivial 过滤): ${pass3 ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`用例 4 (空转/停滞 否决): ${pass4 ? '✅ PASS' : '❌ FAIL'}`)

  if (pass1 && pass2 && pass3 && pass4) {
    console.log('\n🎉 所有独立评估引擎单测全部通过！')
  } else {
    process.exit(1)
  }
}

runTests().catch(console.error)
