/**
 * 评估引擎测试用会话构造器：用最小成本合成平台无关/平台特定会话。
 */
import type { EvaluationContext } from '@session-hub/analyzer'

export interface TcMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content?: string
  thought?: string
  toolCalls?: Array<{ name: string, arguments?: unknown, args?: unknown, input?: string }>
}

function ctx(platform: string, id: string, title: string, messages: TcMessage[], cwd = '/demo/project'): EvaluationContext {
  return {
    sessionId: id,
    platform,
    title,
    cwd,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content || '',
      thought: m.thought,
      toolCalls: m.toolCalls as EvaluationContext['messages'][number]['toolCalls']
    }))
  }
}

export const CONTRACT_PATCH = `*** Begin Patch
*** Add File: server/utils/billing-service.ts
+export interface BillingOptions {
+  currency: string
+  retryTimes: number
+}
+
+export function chargeOrder(orderId: string, opts: BillingOptions) {
+  try {
+    const res = await retry(() => postPayment(orderId, opts), opts.retryTimes)
+    return res
+  } catch (err) {
+    throw new Error('payment timeout: ' + orderId)
+  }
+}
*** End Patch`

export const CONTRACT_CONTENT = `export interface BillingOptions {
  currency: string
  retryTimes: number
}

export function chargeOrder(orderId: string, opts: BillingOptions) {
  try {
    const res = await retry(() => postPayment(orderId, opts), opts.retryTimes)
    return res
  } catch (err) {
    throw new Error('payment timeout: ' + orderId)
  }
}`

/** 高价值契约改动会话（thought 通道），可选择平台工具风格 */
export function contractSession(platform: 'claude' | 'codex' | 'pi' = 'claude'): EvaluationContext {
  const editTool = platform === 'claude'
    ? { name: 'apply_patch', input: CONTRACT_PATCH }
    : platform === 'codex'
      ? { name: 'update_file', arguments: { path: 'server/utils/billing-service.ts', content: CONTRACT_CONTENT } }
      : { name: 'write_file', arguments: { path: 'server/utils/billing-service.ts', content: CONTRACT_CONTENT } }
  const verifyTool = platform === 'claude'
    ? { name: 'Bash', arguments: { command: 'pnpm test billing' } }
    : platform === 'codex'
      ? { name: 'shell', arguments: { command: 'pnpm test billing' } }
      : { name: 'exec_command', arguments: { command: 'pnpm test billing' } }

  return ctx(platform, `s-contract-${platform}`, '支付重试与超时容错重构', [
    { role: 'user', content: '支付接口偶发超时，帮我加重试并把配置抽成接口，另外分析下根因。' },
    {
      role: 'assistant',
      thought: '根因分析：下游网关 30s 超时直接抛出，没有重试。权衡方案：相比在调用点写死重试次数，抽成 BillingOptions 配置项更利于多业务复用；需要注意幂等边界这个避坑点，否则会导致重复扣款。',
      content: '我会新增 billing-service 并补重试。',
      toolCalls: [
        { name: platform === 'claude' ? 'Grep' : platform === 'codex' ? 'grep' : 'search', arguments: { pattern: 'postPayment' } },
        editTool,
        verifyTool
      ]
    },
    { role: 'user', content: '测试跑一下' },
    {
      role: 'assistant',
      content: '已完成：测试通过 ✅，新增 BillingOptions 接口与重试逻辑，超时抛出明确错误。'
    }
  ])
}

/** 平凡问答：无工具、无改动、短回复 */
export function trivialSession(): EvaluationContext {
  return ctx('pi', 's-trivial', '问候', [
    { role: 'user', content: '今天天气怎么样' },
    { role: 'assistant', content: '我无法查询实时天气。' }
  ])
}

/** thrashing + 盲搜 + 未闭环：触发 veto */
export function thrashingSession(): EvaluationContext {
  const bigThought = '我在反复尝试定位问题，可能是配置的问题，需要继续搜索更多线索。\n'.repeat(400) // ~15k 字，段落高重复
  const searchCalls = Array.from({ length: 28 }, (_, i) => ({
    name: i % 2 === 0 ? 'Grep' : 'glob',
    arguments: { pattern: `keyword${i}` }
  }))
  const messages: TcMessage[] = [
    { role: 'user', content: '帮我排查这个复杂问题' }
  ]
  for (let i = 0; i < 3; i++) {
    messages.push({
      role: 'assistant',
      thought: bigThought,
      content: '还在搜索...',
      toolCalls: searchCalls.slice(i * 9, i * 9 + 9)
    })
    messages.push({ role: 'user', content: '还是没好' })
  }
  messages.push({
    role: 'assistant',
    content: 'Error: Command failed with exit code 1，目前无法解决这个问题。'
  })
  return ctx('claude', 's-thrashing', '未解决的复杂排查', messages)
}

/** 无 thinking 但高价值：结构化回复 + 核心改动 + 验证闭环 */
export function noThoughtHighValueSession(): EvaluationContext {
  return ctx('codex', 's-no-thought', '新增缓存失效接口', [
    { role: 'user', content: '给缓存服务加一个按 key 失效的接口' },
    {
      role: 'assistant',
      content: '好的，新增接口并补充异常处理。',
      toolCalls: [
        { name: 'update_file', arguments: { path: 'server/utils/cache-service.ts', content: CONTRACT_CONTENT } },
        { name: 'shell', arguments: { command: 'pnpm test cache' } }
      ]
    },
    {
      role: 'assistant',
      content: '## 变更说明\n- 新增 invalidate(key) 接口，按 key 精准失效缓存条目\n- 底层 DB 不存在时返回 false，超时抛出明确的 TimeoutError\n- 补充了异常保护，失败不会影响主流程写入\n\n## 验证\n已运行 pnpm test cache 全部通过 ✅，改动已完成并验证。'
    }
  ])
}

/** Gotcha 场景：根因排障成功，无契约改动 */
export function gotchaSession(): EvaluationContext {
  return ctx('claude', 's-gotcha', 'SSE 单例连接泄漏排查', [
    { role: 'user', content: 'SSE 客户端重连后消息重复，帮我排查。' },
    {
      role: 'assistant',
      thought: '排查过程：先怀疑网络重传，后来发现根本原因是单例 EventSource 没有在卸载时 close，新旧连接同时收消息。避坑点：注意不能只在 error 回调里重连，否则会导致连接叠加，需要在生命周期 teardown 中统一关闭。',
      content: '先看连接管理代码。',
      toolCalls: [
        { name: 'Grep', arguments: { pattern: 'EventSource' } },
        { name: 'Read', arguments: { path: 'server/utils/mcp-server-instance.ts' } }
      ]
    },
    { role: 'user', content: '然后呢' },
    {
      role: 'assistant',
      thought: '根因确认后，修复方案：在 dispose 中关闭连接并加守卫。权衡：相比每次新建实例，复用单例加状态守卫改动更小。',
      content: '修复重复连接问题。',
      toolCalls: [
        { name: 'apply_patch', input: `*** Begin Patch\n*** Update File: server/utils/mcp-server-instance.ts\n@@\n- const source = new EventSource(url)\n+ if (activeSource) activeSource.close()\n+ const source = new EventSource(url)\n+ activeSource = source\n*** End Patch` },
        { name: 'Bash', arguments: { command: 'pnpm test sse' } }
      ]
    },
    { role: 'assistant', content: '已修复，测试通过 ✅。根因是单例未关闭导致连接叠加。' }
  ])
}

/** Milestone 场景：多文件落地 + 容错 + 深度权衡，但无契约/根因特征，末轮中性收尾无闭环信号 */
export function milestoneSession(): EvaluationContext {
  const plainModule = (name: string, withCatch = false) => [
    `export function ${name}(input: unknown) {`,
    withCatch
      ? '  try { return pipeline(input) } catch (err) { return fallback(input) }'
      : '  return pipeline(input)',
    '}',
    '',
    'function pipeline(v: unknown) { return v }',
    'function fallback(v: unknown) { return v }'
  ].join('\n')

  return ctx('codex', 's-milestone', '重构报表渲染流程', [
    { role: 'user', content: '把报表渲染拆成 normalize/pipeline/render 三步，拆到多个模块，要有降级处理' },
    {
      role: 'assistant',
      thought: '这是一次常规的流水线拆分。我的权衡是：相比于把三步放在一个大函数里，按职责拆成独立模块更利于单测和复用，但缺点是文件变多、调用链变长、跨文件跳转成本上升；考虑到后续还有两条业务线要接入同一套渲染流程，拆分的长期可维护性收益高于短期文件数成本。先梳理数据流方向，再确定模块边界，保证每个阶段输入输出都是普通对象，不引入额外耦合，也不依赖全局状态；命名上沿用项目既有约定，导出的函数保持纯函数语义，方便后续在其他报表场景中按同样的三段式组合复用。目录结构上三个模块平铺在 server/utils 下即可，不需要新建子目录增加层级；类型定义暂时内联在各自模块，等第二条业务线真正接入时再提取共享类型，避免提前抽象。函数命名统一采用动词加宾语的形式，参数顺序保持输入在前、选项在后，和项目里其他工具模块的风格一致，这样阅读者不需要额外记忆本模块特有的约定。',
      content: '先读一下现有渲染代码。',
      toolCalls: [
        { name: 'grep', arguments: { pattern: 'renderReport' } },
        { name: 'update_file', arguments: { path: 'server/utils/report-render.ts', content: plainModule('renderReport') } }
      ]
    },
    { role: 'user', content: '继续，另外两个模块也建起来' },
    {
      role: 'assistant',
      thought: '继续完成拆分。我的权衡是：降级逻辑放在 pipeline 内部还是由调用方处理，放在内部可以让所有调用方统一受益、避免每个接入方重复实现兜底，代价是 pipeline 模块多承担一点职责；综合来看放在内部更合适，所以在 pipeline 模块里提供 fallback。normalize 保持纯函数无副作用，render 只关心输出形态不做数据修正，避免职责反向渗透。三个模块边界清晰，调用顺序固定为 normalize、pipeline、render，每一步都可以独立单测，输入输出契约简单明确。整体篇幅适中，不需要引入事件机制、注册表或更复杂的抽象，按最简单直接、可读的方式落地即可，后续如果出现第四条处理阶段，再考虑把顺序配置化，当前保持显式调用更利于代码检索和新人理解。另外输入为空、字段缺失两类边界数据统一在 normalize 阶段兜底成默认结构，保证 pipeline 和 render 永远拿到形状稳定的对象，这样下游就不需要各自判空，减少了防御性代码在多个模块反复出现的可能，也让单测构造用例时更简单直接。测试方面三个模块各准备一份输入样例即可覆盖主干路径，后续接入新业务时按同样的样例结构补充数据，维护成本可控。',
      content: '三个模块都建好了。',
      toolCalls: [
        { name: 'update_file', arguments: { path: 'server/utils/report-pipeline.ts', content: plainModule('runPipeline', true) } },
        { name: 'update_file', arguments: { path: 'server/utils/report-normalize.ts', content: plainModule('normalizeReport') } }
      ]
    }
  ])
}
