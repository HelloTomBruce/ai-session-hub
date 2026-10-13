import { SearchSessionsFtsTool } from './search-sessions-fts'
import { ListSessionsTool } from './list-sessions'
import { GetSessionDetailsTool } from './get-session-details'
import { SearchKnowledgeVaultTool } from './search-knowledge-vault'
import { GetProjectAdrsTool } from './get-project-adrs'
import { CaptureSessionInsightTool } from './capture-session-insight'
import { DistillKnowledgeTool } from './distill-knowledge'
import { EvaluateSessionValueTool } from './evaluate-session-value'
import { GetHubStatsTool } from './get-hub-stats'
import { RecallMemoriesTool } from './recall-memories'
import { GetMemoryTool } from './get-memory'
import { SearchMemoryGraphTool } from './search-memory-graph'
import { RateMemoryTool } from './rate-memory'
import { SaveMemoryTool } from './save-memory'

export const mcpTools = [
  SearchSessionsFtsTool,
  ListSessionsTool,
  GetSessionDetailsTool,
  SearchKnowledgeVaultTool,
  GetProjectAdrsTool,
  CaptureSessionInsightTool,
  DistillKnowledgeTool,
  EvaluateSessionValueTool,
  GetHubStatsTool,
  RecallMemoriesTool,
  GetMemoryTool,
  SearchMemoryGraphTool,
  RateMemoryTool,
  SaveMemoryTool
]
