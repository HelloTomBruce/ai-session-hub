import type { SessionMessage, SessionToolCall, UnifiedSession } from '@session-hub/core'
import type { AIEvaluationResult } from './types.js'


/**
 * 标准评估准则 (Evaluation Rubric & System Prompt)
 * 该准则作为 AI Judge 的严格打分标准，确保不同会话、不同模型的评估基准统一。
 */
export const EVALUATOR_SYSTEM_PROMPT = `你是一名资深的 AI 编程会话效能诊断与审计专家 (AI Coding Session Evaluator)。
你的任务是根据提供的会话全量交互记录（包括 User 提问、AI 的 Thinking 思考过程、Tool Calls 工具调用及其参数与返回内容），依据一套客观、严密且标准化的评估准则（Rubric），对本次会话中 AI 完成任务的效能进行量化诊断与归因分析。

---

### 【标准评分准则 (Evaluation Rubric)】

综合得分（总分 100 分）由以下 4 个独立维度加权计算构成：

#### 1. 路径精准度 (Directness & Search Efficiency) - 权重 35%
* **基准定义**：AI 是否能通过最少的探索（读文件、搜索代码、列目录）直接精准定位到需要修改的代码。
* **打分标准**：
  - 100 分 (极准)：阅读/搜索 1~3 个关键文件即精准找到目标并修改。
  - 80~90 分 (正常)：阅读/搜索 4~7 个相关文件后定位。
  - 60~75 分 (偏多)：大范围在无关目录搜索（8~15 次检索），存在一定的迷茫/盲搜。
  - < 60 分 (低效)：盲目调用 15 次以上搜索/阅读工具，严重缺乏项目结构认知。

#### 2. 决策质量与无摩擦度 (Decision Soundness & Non-friction) - 权重 30%
* **基准定义**：AI 自身方案是否稳健，是否发生思路推翻、改动回滚或低级语法/命令错误。
* **严格区分注意点（核心防误判准则）**：
  - ⚠️ **严禁误判**：AI 正常帮助用户排查修复外部 Bug、分析错误堆栈，属于【正常解题】，绝非摩擦，不得扣分！
  - ⚠️ **真正扣分项**：
    1. **AI 自身推翻方案** (Backtracking)：思考链中出现“等等，我刚才的改法不对”、“放弃这个思路”、“修改导致了新报错，需要撤销”等自我否定（每次真实推翻扣 5~8 分）。
    2. **工具命令硬报错** (Execution Failure)：执行测试/编译/脚本发生未预期的非 0 exit code 或语法错误（每次扣 4~6 分）。
    3. **文件编辑冲突** (Edit Conflict)：因为行号或文本不匹配导致的工具调用失败（每次扣 3 分）。

#### 3. 交互周转效率 (Turn Velocity & Autonomy) - 权重 20%
* **基准定义**：完成既定目标所需的用户提示与纠偏轮次。
* **打分标准**：
  - 100 分：1~3 轮问答内彻底闭环解决。
  - 85 分：4~6 轮问答内解决，用户仅补充了少许细节。
  - 65 分：7~10 轮问答，用户多次介入纠正方向。
  - < 50 分：超过 10 轮反复拉扯纠偏。

#### 4. 行动有效性 (Action Density & Outcome) - 权重 15%
* **基准定义**：工具调用的实际价值产出比（是否有实际落地代码，还是过度口嗨/空转）。
* **打分标准**：
  - 100 分：修改落地清晰，有测试或验证，产出明确。
  - 70 分：只给出了文字方案或部分修改，未完全收敛。
  - 40 分：执行了大量无副作用工具，但最终未解决问题。

---

### 【评级划分 (Grade Thresholds)】
* **S 级 (90~100 分)**：极速闭环 (One-Shot / Near Perfect)，零返工，精准命中。
* **A 级 (75~89 分)**：稳健高效 (Systematic)，正常推导，少量可控探索，方案落地。
* **B 级 (60~74 分)**：偶有波折 (Friction-heavy)，存在 2 次以上自我推翻或探索路径冗长。
* **C 级 (< 60 分)**：低效循环 (Lost in Context)，大量报错、频繁推翻或反复拉扯。

---

### 【输出格式要求】
必须严格输出标准的 JSON 格式对象（不要包裹任何额外的解释文字），结构定义如下：
{
  "score": 85,
  "grade": "A",
  "gradeLabel": "稳健高效",
  "taskSummary": "一句话概括本次会话解决的核心任务",
  "taskCompletionStatus": "Full" | "Partial" | "Failed" | "Inconclusive",
  "subScores": {
    "directness": 85,
    "decisionSoundness": 90,
    "turnVelocity": 85,
    "actionDensity": 80
  },
  "deductions": [
    {
      "category": "backtrack" | "search_heavy" | "command_error" | "misunderstanding" | "revert",
      "turn": 2,
      "title": "简短归因标题 (如: 第2轮发现组件缺少导出，推翻了原先的局部修改方案)",
      "deductionPoints": 6,
      "reason": "客观详细阐述为什么扣分，说明真实的因果关系",
      "evidenceSnippet": "摘录当时的真实 thought 或 tool output 作为铁证"
    }
  ],
  "strengths": [
    "亮点1: 如精准利用 LSP 工具快速定位到了目标函数",
    "亮点2: 方案推导逻辑清晰，一次性测试通过"
  ],
  "bottlenecks": [
    "瓶颈1: 如缺少工程图谱导致单轮检索了过多无关目录"
  ],
  "prescriptions": [
    "处方建议1: 为项目配置相关技能以减少探索开销",
    "处方建议2: 提问时提供更精确的受影响文件范围"
  ]
}
`

/**
 * 构造用于发送给 LLM 的标准化评估 Payload
 */
export function buildEvaluationPrompt(session: UnifiedSession, messages: SessionMessage[]): string {
  const transcriptLines: string[] = []

  let turn = 1
  for (const msg of messages) {
    if (msg.role === 'user') {
      transcriptLines.push(`\n=== [Turn ${turn++}] USER INPUT ===\n${msg.content}`)
    } else if (msg.role === 'assistant') {
      transcriptLines.push(`\n--- [Turn ${turn - 1}] ASSISTANT RESPONSE ---`)
      if (msg.thought) {
        transcriptLines.push(`[Thinking Process / Thought]:\n${msg.thought}`)
      }
      if (msg.toolCalls && msg.toolCalls.length) {
        transcriptLines.push(`[Tool Calls (${msg.toolCalls.length})]:`)
        for (const tool of msg.toolCalls) {
          const name = tool.name || tool.type || 'tool'
          const args = typeof tool.arguments === 'string' ? tool.arguments : JSON.stringify(tool.arguments || tool.args || tool.input || {})
          transcriptLines.push(`  * ${name}: ${args}`)
        }
      }
      if (msg.content) {
        transcriptLines.push(`[Output Content]:\n${msg.content}`)
      }
    }
  }

  return `请根据上述【标准评估准则 (Evaluation Rubric)】，对以下具体的会话交互全量轨迹进行严格审计与客观评分：

【会话基本元数据】
- 平台分类: ${session.cli.toUpperCase()}
- 会话标题: ${session.title}
- 工作目录: ${session.cwd}
- 会话交互总轮次: ${messages.length} 消息

【完整会话轨迹 (Transcript)】
${transcriptLines.join('\n')}
`
}

export function runDeterministicRubricEvaluation(session: UnifiedSession, messages: SessionMessage[]): AIEvaluationResult {
  let editCount = 0
  let searchCount = 0
  let commandCount = 0
  let backtrackCount = 0
  let userTurns = 0
  const deductions: AIEvaluationResult['deductions'] = []

  let currentTurn = 1
  for (const msg of messages) {
    if (msg.role === 'user') {
      userTurns++
      currentTurn++
    } else if (msg.role === 'assistant') {
      // 严格识别真正的自我否定句式
      if (msg.thought) {
        const thought = msg.thought
        const isTrueBacktrack
          = /等等|不对|刚才的改动|改错了|不能这样|放弃这个方案|撤销之前的修改|无法正常工作|wait,\s*(this|my|that)\s*(won't|broke|failed|is wrong)/i.test(thought)
            && !/用户报错|用户提到|正常排查|排查该问题/i.test(thought)

        if (isTrueBacktrack) {
          backtrackCount++
          deductions.push({
            category: 'backtrack',
            turn: currentTurn,
            title: `第 ${currentTurn} 轮: 方案出现推翻与思路自我修正`,
            deductionPoints: 6,
            reason: '思考链中显式推翻了前序假设或推导方案，产生了重试开销。',
            evidenceSnippet: thought.slice(0, 200) + (thought.length > 200 ? '...' : '')
          })
        }
      }

      if (msg.toolCalls && msg.toolCalls.length) {
        let turnSearches = 0
        for (const tool of msg.toolCalls) {
          const rawName = tool.name || tool.type || ''
          const name = rawName.toLowerCase()
          if (/edit|write|replace|modify|patch|create/i.test(name)) {
            editCount++
          } else if (/grep|find|search|glob|list_dir|view_file|read/i.test(name)) {
            searchCount++
            turnSearches++
          } else if (/command|run_command|bash|exec/i.test(name)) {
            commandCount++
          }
        }

        if (turnSearches >= 8) {
          deductions.push({
            category: 'search_heavy',
            turn: currentTurn,
            title: `第 ${currentTurn} 轮: 单轮触发大量密集搜索 (${turnSearches} 次)`,
            deductionPoints: 8,
            reason: '单轮发生高密度盲目搜索，反映出对代码结构缺少先验认知。',
            evidenceSnippet: msg.toolCalls.map((t: SessionToolCall) => (t.name || t.type || 'tool').replace(/^default_api:/, '')).join(', ')
          })
        }
      }
    }
  }

  // 1. Directness (35%)
  let directness = 100
  const totalExplores = searchCount
  if (editCount > 0) {
    const ratio = totalExplores / editCount
    if (ratio <= 3) directness = 100
    else if (ratio <= 6) directness = 88
    else if (ratio <= 12) directness = 72
    else directness = 55
  } else if (totalExplores > 8) {
    directness = 60
  }

  // 2. Decision Soundness (30%)
  const decisionSoundness = Math.max(20, 100 - backtrackCount * 18)

  // 3. Turn Velocity (20%)
  let turnVelocity = 100
  if (userTurns > 4) {
    turnVelocity = Math.max(30, 100 - (userTurns - 4) * 12)
  }

  // 4. Action Density (15%)
  let actionDensity = 90
  if (editCount >= 1) actionDensity = 100
  else if (commandCount > 10 && editCount === 0) actionDensity = 60

  const totalScore = Math.round(
    directness * 0.35
    + decisionSoundness * 0.30
    + turnVelocity * 0.20
    + actionDensity * 0.15
  )

  const finalScore = Math.max(20, Math.min(100, totalScore))

  let grade: 'S' | 'A' | 'B' | 'C'
  let gradeLabel: string
  if (finalScore >= 90) {
    grade = 'S'
    gradeLabel = '极速闭环 (One-Shot)'
  } else if (finalScore >= 75) {
    grade = 'A'
    gradeLabel = '稳健高效 (Systematic)'
  } else if (finalScore >= 60) {
    grade = 'B'
    gradeLabel = '偶有波折 (Friction-heavy)'
  } else {
    grade = 'C'
    gradeLabel = '低效循环 (Lost in Context)'
  }

  const strengths: string[] = []
  const bottlenecks: string[] = []
  const prescriptions: string[] = []

  if (directness >= 85) strengths.push('代码定位非常精准，以极少的文件探索快速命中目标修改点。')
  if (decisionSoundness >= 90) strengths.push('推导逻辑严密，方案一次性通过，无多余的反复推翻。')
  if (userTurns <= 3) strengths.push('自主解决能力强，在极少轮次内达成了任务闭环。')

  if (directness < 75) {
    bottlenecks.push('文件探索比例偏高，存在较多跨目录盲搜。')
    prescriptions.push('建议为项目引入代码图谱 MCP (如 codebase-memory-mcp) 增强导航能力。')
  }
  if (backtrackCount > 0) {
    bottlenecks.push(`会话中出现了 ${backtrackCount} 次方案推翻或修正重试。`)
    prescriptions.push('在初始 Prompt 中明确约束修改范围和上下文边界，避免中途推翻。')
  }
  if (userTurns > 6) {
    bottlenecks.push(`交互轮次较多 (${userTurns} 轮问答)，存在多轮纠偏。`)
    prescriptions.push('建议开启 /plan 模式先制定分步实施计划，减少交互拉扯。')
  }

  if (!strengths.length) strengths.push('完成了指定的基本工作流与交互任务。')
  if (!prescriptions.length) prescriptions.push('本次会话执行高效，符合工程规范，无需特殊改进。')

  return {
    score: finalScore,
    grade,
    gradeLabel,
    taskSummary: session.title || '完成代码开发与调试任务',
    taskCompletionStatus: 'Full',
    subScores: {
      directness,
      decisionSoundness,
      turnVelocity,
      actionDensity
    },
    deductions,
    strengths,
    bottlenecks,
    prescriptions,
    evaluatedAt: Date.now()
  }
}
