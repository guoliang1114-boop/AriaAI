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

任务识别函数：

```python
detect_project_task_type(content)
```

识别原则：

- 必须同时有“文件类型/交付物类型”和“创建动作”。
- 例如“准备一个访谈 Excel”会进入 Orchestrator。
- 例如“介绍一下这个报告的重点”不会进入 Orchestrator，只走普通 LLM 回答。

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

标准步骤：

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
123 passed
npm run build 通过
```
