# Orchestrator 与 Executor 任务编排说明

更新日期：2026-05-18

## 1. 背景

项目对话里有两类请求：

- 普通问答：例如“这个项目风险是什么”“解释一下这份报告重点”。
- 执行型任务：例如“给客户准备一个 PPT”“准备一个访谈 Excel”“生成一份项目总结 Word”。

普通问答应该由 LLM 直接回答，不应该创建任务、不应该出现复杂步骤。

执行型任务需要更稳定的机制：即使浏览器刷新、SSE 断开、某个工具失败，也不能让整个过程丢失。因此引入 Orchestrator + Executor。

## 2. 核心概念

| 概念 | 说明 |
|---|---|
| Orchestrator | 负责任务识别、创建 TaskRun、拆分 TaskStep、记录事件和状态 |
| Executor | 负责逐步执行 TaskStep，调用项目上下文、Office 工具、空间保存等能力 |
| TaskRun | 一次可恢复的项目任务，例如“准备访谈 Excel” |
| TaskStep | TaskRun 下的具体步骤，例如“收集项目上下文”“生成交付物结构” |
| TaskEvent | 任务运行日志，例如 step_started、step_completed、step_failed |
| TaskArtifact | 任务生成物，例如 PPTX、DOCX、XLSX、PDF 文件 |

核心文件：

```text
AriaAI/backend/app/services/task_orchestrator.py
AriaAI/backend/app/services/chat_streaming.py
aria-web/src/pages/projects/useProjectChatComposer.ts
```

## 3. 当前支持的任务类型

当前已支持：

| task_type | 触发场景 | 输出 |
|---|---|---|
| `generate_client_ppt` | 准备客户介绍 PPT / deck / 演示材料 | PPTX |
| `generate_project_excel` | 准备 Excel / 表格 / 访谈表 / 清单 / 台账 | XLSX |
| `generate_project_docx` | 生成 Word / DOCX / 文档 / 报告 / 方案 | DOCX |
| `generate_project_pdf` | 输出 PDF | PDF |

任务识别入口：

```python
route_project_task_request(content)
```

当前由 LLM Router 优先判断是否进入 Orchestrator，并返回结构化结果：

- `task_type`
- `confidence`
- `reason`
- `output_kind`
- `plan_steps`

如果 LLM Router 不可用或返回不可解析内容，会降级到规则路由：

- “准备一个访谈 Excel”会进入 Orchestrator。
- “帮我整理一份项目风险清单”会进入 Text artifact 任务。
- “介绍一下这个报告的重点”不会进入 Orchestrator，只走普通 LLM 回答。

## 3.1 路由仲裁原则：Rule-First Arbitration

当前路由不是“完全相信 LLM Router”。更准确的规则是：

```text
规则路由先给出 rule_intent / confidence
LLM Router 再给出 llm_intent / confidence / plan_steps
如果规则高置信命中，且 LLM 把它降级为 direct 或改成另一个 task_type：
  使用规则路由
  记录 router disagreement 日志
否则：
  使用 LLM Router 的结构化结果，尤其是 plan_steps
```

这样做的原因是：顾问能力目录、文件类型识别、用户明确要求的章节结构，属于确定性业务约束；LLM Router 适合补充边缘判断和动态步骤，不应该覆盖已经明确命中的能力。

例如“客户会议准备 + 开场话术 / 关键议题顺序 / 关键人表达方式 / 会后行动清单”已经命中 `client_meeting_brief`，即使 LLM Router 误判为普通 direct，也必须进入 `create_text_artifact`。

当前已支持：

| task_type | 输出 |
|---|---|
| `create_text_artifact` | 仅文本交付，不生成 Office 文件 |

## 3.2 顾问通用能力目录

为了避免继续用零散关键词打补丁，项目对话现在引入顾问能力目录：

```text
AriaAI/backend/app/services/consulting_capabilities.py
```

这个目录用于描述“用户要的是什么顾问交付物”，而不是直接写死某一句话。每个能力包含：

- `id`：稳定能力标识
- `artifact_kind`：默认输出类型，例如 MD、PPTX、XLSX
- `trigger_terms`：用于 Router 的触发线索
- `default_title`：干净的交付物标题
- `default_sections`：默认结构
- `quality_rules`：生成后的质量要求

能力目录不只是“触发词表”，而是能力协议的来源。每次命中能力后，系统会形成一份 `CapabilityProtocol`：

| 字段 | 用途 |
|---|---|
| `required_sections` | 必须出现的章节或模块 |
| `quality_rules` | 生成内容必须满足的质量规则 |
| `min_chapter_count` | 故事线等结构型交付物的最少章节数 |
| `requires_hierarchy` | 是否必须有一级 / 二级目录 |
| `output_schema` | 给 Planner / Executor / 校验层共用的输出结构约束 |

这意味着“客户会议准备”“故事线”“问题树”等能力不再依赖自由生成。Router 只决定是否进入任务，能力协议决定应该生成什么结构，Executor 在保存前会校验结构是否完整。

当前沉淀的高频顾问能力：

| capability_id | 场景 | 默认输出 | 说明 |
|---|---|---|---|
| `client_meeting_brief` | 客户会议准备 | MD | 开场话术、议题顺序、关键人表达、会后行动 |
| `consulting_storyline` | 咨询故事线 / 一级二级目录 | MD | 至少 10 章的结构化叙事大纲 |
| `interview_guide` | 访谈提纲 | MD | 访谈对象、目标、问题、追问、记录方式 |
| `issue_tree` | 问题树 / MECE 拆解 | MD | 核心问题、一级议题、二级议题、验证点 |
| `hypothesis_tree` | 假设树 | MD | 核心判断、关键假设、证据、判定标准 |
| `research_plan` | 桌面研究计划 | MD | 研究问题、信息源、验证路径、输出格式 |
| `opportunity_assessment` | 机会评估 | MD | 赛道吸引力、客户适配度、进入难度、验证成本 |
| `strategic_options` | 战略选项 | MD | 方案 A/B/C、比较维度、推荐路径 |
| `implementation_plan` | 落地计划 | MD | 阶段、里程碑、责任、依赖、风险、KPI |

Router 会先匹配能力目录，再决定是否创建 `create_text_artifact`。例如：

- “这个故事线不行，至少 10 个章节，需要一级和二级目录”会识别为 `consulting_storyline`。
- “帮我做一个 MECE 问题树，拆成一级和二级议题”会识别为 `issue_tree`。
- “请严格输出开场话术、关键议题顺序、关键人表达方式、会后行动清单”会识别为 `client_meeting_brief`。

能力目录只负责“识别和结构约束”，具体执行仍由 Orchestrator + Executor 完成。

这些成熟能力也会作为内置 Skills 出现在 `/skills` 页面。部署后执行：

```text
POST /api/skills/seed-pro
```

会自动补齐以下 Skills，名称统一使用 `顾问能力｜` 前缀，避免和用户自建 Skill 冲突：

- `顾问能力｜客户会议准备`
- `顾问能力｜咨询故事线大纲`
- `顾问能力｜访谈提纲`
- `顾问能力｜问题树拆解`
- `顾问能力｜假设树`
- `顾问能力｜桌面研究计划`
- `顾问能力｜机会评估`
- `顾问能力｜战略选项设计`
- `顾问能力｜落地计划`

这些 Skills 适合用户主动选择使用；而在项目对话里，Router 仍会根据用户输入自动识别相同能力并进入对应的 Orchestrator 流程。

每个 `顾问能力｜...` Skill 以及项目对话里的自动能力任务，都必须至少包含统一四步：

```text
步骤 1/4：收集上下文
步骤 2/4：规划结构
步骤 3/4：生成内容
步骤 4/4：校验并交付
```

具体能力可以在这四步下扩展更多细节，但不能跳过这些基本步骤。

当前文本交付物的后端步骤对应为：

| 步骤 | step_type | 说明 |
|---|---|---|
| 收集上下文 | `collect_project_context` | 读取项目、客户、结构化记忆、干系人等上下文 |
| 规划结构 | `plan_text_artifact` | 根据能力协议生成 required_sections / output_schema / quality_rules |
| 生成内容 | `draft_text_artifact` | 按协议生成 Markdown，并保存到项目空间 |
| 校验并交付 | `summarize_result` | 返回交付物卡片和执行摘要 |

## 4. 执行流程

以“我想要准备一个访谈的 Excel”为例：

```text
用户消息
  ↓
chat_streaming.detect_project_task_type
  ↓
create_task_run
  ↓
创建 TaskRun + TaskStep
  ↓
stream_execute_task_run_in_session
  ↓
Executor 逐步执行
  ↓
生成文件并保存到项目空间
  ↓
返回任务日志、附件卡片、最终回复
```

Planner 会优先使用 Router 返回的 `plan_steps` 创建动态步骤。若没有可靠计划，则使用默认步骤。

默认 Office 步骤：

```text
1. 收集项目上下文
2. 生成交付物结构
3. 生成并保存文件
4. 整理交付结果
```

PPT 任务使用专门步骤：

```text
1. 收集项目上下文
2. 生成结构化大纲
3. 生成并保存 PPT
4. 整理交付结果
```

Text artifact 默认步骤：

```text
1. 收集项目上下文
2. 生成文本交付内容
3. 整理交付结果
```

## 5. 聊天分流策略

`chat_streaming.py` 负责在项目对话中做分流。

```text
如果 detect_project_task_type(content) 返回 task_type：
  创建 durable TaskRun
  走 Orchestrator + Executor
否则：
  走普通 LLM / 工具调用流
```

这样避免所有问题都进入复杂任务模式。

设计原则：

- 问答类请求直接回答。
- 文件交付类请求进入 durable task。
- 普通工具调用仍可以存在，但不替代 durable task。
- 能被恢复、重试、审计的任务优先用 Orchestrator。

## 6. 前端展示

前端聊天页现在会消费两类事件：

| 事件 | 作用 |
|---|---|
| `status` + `step_index` | 渲染流式步骤卡 |
| `task_run` | 从真实 TaskRun.steps / artifacts 生成步骤卡和附件卡 |

相关文件：

```text
aria-web/src/pages/projects/useProjectChatComposer.ts
aria-web/src/pages/projects/ProjectChatMessages.tsx
aria-web/src/pages/projects/ProjectChatToolCallCard.tsx
aria-web/src/pages/projects/ProjectTaskRunsDrawer.tsx
aria-web/src/types/api.ts
```

前端不再只依赖临时 status 文本，而是可以直接读取：

```text
task_run.steps
task_run.artifacts
```

这样刷新、重连或任务较长时，用户仍能理解执行进度。

步骤卡支持展开 / 收起详细日志，偏好会保存在浏览器本地。任务详情抽屉会展示：

- TaskRun 基本信息
- TaskStep 状态
- TaskEvent 完整日志
- TaskArtifact 生成物
- Text artifact 正文
- 失败任务重试入口
- 可取消任务的取消入口

## 7. 失败与恢复

Executor 执行每一步时会记录：

- step status
- output
- error_code
- error_message
- TaskEvent

失败时：

- 当前步骤标记为 `failed`
- 已完成步骤保留
- 后续步骤保持 `pending`
- 用户可以从失败步骤重试

相关接口：

```text
GET  /projects/{project_id}/task-runs
GET  /projects/{project_id}/task-runs/{task_id}
POST /projects/{project_id}/task-runs/{task_id}/retry
POST /projects/{project_id}/task-runs/{task_id}/cancel
POST /projects/{project_id}/task-runs/{task_id}/pause
POST /projects/{project_id}/task-runs/{task_id}/resume
```

取消任务采用合作式取消：

- 未开始或等待中的步骤会标记为 `skipped`
- 已完成步骤保留
- 正在执行的工具调用不强杀，避免文件写入到一半造成不一致
- Executor 会在进入下一步前检查 `canceled` 状态，不再继续执行

暂停 / 恢复任务也采用合作式机制：

- 暂停后，当前步骤如果已经在执行，会先自然结束
- Executor 进入下一步前会检查 `paused` 状态并停住
- 恢复后从下一个未完成步骤继续

## 8. 当前边界

目前这套机制已经覆盖主流 Office 交付物，但仍不是完整 agent workflow 平台。

当前边界：

- 任务识别仍是规则优先，不是完整 LLM planner。
- Excel / Word / PDF 的内容结构是模板化生成，后续可接入更强的规划器。
- 前端已有步骤卡、附件卡和任务详情抽屉。
- 取消、暂停、恢复已支持合作式机制；人工确认、分支任务还没有完整产品化。
- 现在是固定步骤模板，不是任意 DAG 工作流。

## 9. 后续增强方向

建议优先级：

1. 引入轻量 Planner  
   对复杂请求先生成结构化计划，再创建 TaskStep。

2. 增加人工确认步骤  
   例如覆盖文件、发送客户材料、删除文件前等待用户确认。

3. 支持更多任务类型  
   例如 research_and_write、update_project_file、multi_step_delivery。

4. 更细的 Executor 适配器  
   把 Office、空间文件、项目记忆、客户干系人分别做成独立 executor。

## 10. 验证

当前相关测试：

```bash
cd AriaAI/backend
.venv/bin/python -m pytest tests/test_task_orchestrator.py tests/test_chat_streaming.py
```

前端构建：

```bash
cd aria-web
npm run build
```

最近一次验证：

```text
125 passed
npm run build 通过
```
