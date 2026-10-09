# @session-hub/plugin-zcode

ZCode 桌面端与 CLI 会话解析插件，为 AI Session Hub 提供完整的 ZCode 历史会话聚合、消息流解析、工具调用提取与会话管理能力。

## 特性

- 自动探查 `~/.zcode/cli/db/db.sqlite` 数据库及 `~/.zcode/v2/tasks-index.sqlite` 索引
- 完整解析多轮对话、思考链（Reasoning / Thinking）、工具调用（Tool calls）与状态输出
- 支持会话重命名、会话删除与新建会话
- 聚合模型调用信息（如 GLM-5.3、Qwen、DeepSeek 等）与 Token 消耗统计
