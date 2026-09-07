import type { SessionMessage, UnifiedSession } from './types'

export interface AIEvaluationResult {
  score: number
  grade: 'S' | 'A' | 'B' | 'C'
  gradeLabel: string
  taskSummary: string
  taskCompletionStatus: 'Full' | 'Partial' | 'Failed' | 'Inconclusive'
  subScores: {
    directness: number
    decisionSoundness: number
    turnVelocity: number
    actionDensity: number
  }
  deductions: Array<{
    category: 'backtrack' | 'search_heavy' | 'command_error' | 'misunderstanding' | 'revert'
    turn: number
    title: string
    deductionPoints: number
    reason: string
    evidenceSnippet: string
  }>
  strengths: string[]
  bottlenecks: string[]
  prescriptions: string[]
  evaluatedAt: number
}

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
