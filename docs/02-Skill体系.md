# AriaAI Skill 体系

> 更新日期：2026-08-27
> 关联文档：[03-Skill标准化规范](./03-Skill标准化规范.md)、[05-对话系统设计与规范](./05-对话系统设计与规范.md)

## 1. Skill 定位

AriaAI 的 Skill 是可复用的咨询工作流，不是单纯的 prompt 模板。

当前代码里同时存在两类资产：

- 数据库 Skill：运行时主体，模型从 `Skill` 表读取 `system_prompt`、`user_template`、工具定义和 token 配置。
- 文件型 Skill 包：位于 `skills/`，用于沉淀更完整的方法论、reference、模板、脚本和后续标准化资产。

Skill 的产品作用：

- 把高频咨询方法论变成可启动、可复用、可保存的业务动作。
- 把项目/客户上下文带入交付流程，避免用户重复复制背景。
- 把结果沉淀为项目文档、项目笔记、项目记忆或客户记忆。
- 为顾问能力目录和任务编排提供结构化能力基础。

## 2. 当前实现边界

| 维度 | 当前状态 |
|---|---|
| Skill 数据模型 | `backend/app/models/db.py` 中的 `Skill` |
| CRUD 路由 | `GET/POST/PATCH/DELETE /skills` |
| 内置种子 | `backend/app/routers/skills.py` |
| 文件包目录 | `skills/` |
| 工具来源 | `app.tools.registry` 注册的工具 |
| 前端入口 | `web/src/pages/skills/`，项目/客户空间可跳转启动 |
| 对话执行 | `ChatMode.SKILL_EXECUTION` 与 `force_skill` |
| 结果回流 | 项目 Chat 保存为项目文档/笔记，触发记忆 stale/刷新 |

注意：当前代码已有内容安全的 `ChatRun` 生命周期投影、不可变 `SkillRelease` 快照和 `SkillRollout` 发布治理。线上版本与最新编辑版本使用独立指针；预览版本不会直接替换线上契约，管理员可按项目稳定分桶灰度、暂停、推广或回滚，失败率越界时自动切回基线。

部署时 CI 会从干净 checkout 生成 `.aria-release-manifest.json`。服务器中不在清单内、且一级目录确实包含 `SKILL.md` 的历史包不会被直接删除，而会移动到 `/www/backups/ariaai/stale-skills/<UTC时间>/` 可恢复归档；随后服务器再次执行 Skill 固定计数与质量测试，避免旧包继续进入运行时发现范围。

## 3. 数据模型

模型位置：`backend/app/models/db.py`

| 字段 | 说明 |
|---|---|
| `id` | Skill ID |
| `name` | Skill 名称 |
| `category` | 分类 |
| `description` | 描述 |
| `system_prompt` | 注入模型的核心工作流说明 |
| `user_template` | 前端预填输入模板 |
| `estimated_time` | 预计耗时 |
| `max_tokens` | 该 Skill 建议输出上限 |
| `tools_definition_json` | Claude/OpenAI-compatible 工具定义 |
| `tools_json` | 兼容旧版的工具名称列表 |
| `package_version` | 当前已发布语义版本；创建/修改必须满足 semver |
| `package_status` | `preview` / `stable` / `deprecated`；退役版本保留历史但不得进入新一轮启动和自动路由 |
| `package_sha256` | 当前最新编辑契约的精确 SHA-256；迁移会为既有 DB-only Skill 补齐 |
| `active_release_id` | 当前线上不可变 `SkillRelease` 指针，与最新编辑候选分离 |

`SkillRelease` 冻结名称、说明、system prompt、输入模板、工具契约、token 上限、semver、状态和 SHA-256；同一 Skill 的同一精确契约只生成一条记录。`SkillRollout` 只保存基线/候选快照、流量比例、阈值、状态和管理员审计，不保存消息正文、Prompt、工具参数或用户身份。

每个新 `ChatRun` 会复制 `skill_version`、发布状态、SHA-256、精确 `skill_release_id`、灰度 ID/分组/桶位与启用来源。这些是运行时快照，不会因为后来修改或删除 Skill 而变化。迁移前的历史 Run 保持“版本未记录”，不会用当前版本回填并伪造历史归因。

通过 CRUD 修改 `system_prompt`、`user_template` 或工具定义属于运行行为变更，必须同时提交一个严格递增的 `package_version`，降级或复用版本会返回 409。编辑 `preview` 只生成候选快照；活动灰度期间禁止继续编辑或删除，避免被测契约漂移。推广和回滚只移动线上快照指针，不篡改历史版本或历史 Run。

## 4. 路由与缓存

路由文件：`backend/app/routers/skills.py`

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/skills` | 获取 Skill 列表，可按 `category` 过滤 |
| `GET` | `/skills/meta/summary` | 获取轻量摘要列表 |
| `POST` | `/skills` | 创建 Skill |
| `PATCH` | `/skills/{skill_id}` | 更新 Skill |
| `DELETE` | `/skills/{skill_id}` | 删除 Skill |
| `GET` | `/skills/{skill_id}/releases` | 查询不可变发布历史和线上指针 |
| `GET` | `/skills/{skill_id}/rollouts` | 查询内容安全的灰度状态与健康指标 |
| `POST` | `/skills/{skill_id}/rollouts` | 管理员创建项目级稳定灰度 |
| `POST` | `/skills/{skill_id}/rollouts/{rollout_id}/control` | 管理员调比例、暂停、恢复、推广或回滚 |

实现要点：

- 列表和摘要使用 `TTLCache`，默认 300 秒。
- Skill 写接口仅管理员可用；创建/控制请求带预期版本或状态，PostgreSQL 行锁与唯一开放灰度索引共同防止并发覆盖。
- Skill 变更后调用 `_bust_skills()` 清理缓存；运行行为变更必须显式升级 semver。
- 启动时 `ensure_builtin_pro_skills(session)` 补齐内置 Skill。
- `_load_skill_package_prompt()` 可把文件包 `SKILL.md` 和 references 拼入 DB Skill 的 `system_prompt`。

## 5. Skill 执行链路

```text
用户在 UI 选择 Skill 或消息中显式调用 Skill
  ↓
前端携带 skill_id / force_skill / project_id
  ↓
runtime.decide_skill_activation()
  ↓
IntentRouter 进入 ChatMode.SKILL_EXECUTION
  ↓
resolve_skill_release() 按 project > conversation > owner 稳定分桶并冻结精确版本
  ↓
context_builder 注入项目、客户、干系人、RAG 和 Skill prompt
  ↓
filter_tools_for_access() 根据 ActionPolicy 和 ToolAccessPolicy 暴露工具
  ↓
P0-P4 phase 执行
  ↓
输出文本、工具结果或生成物
  ↓
用户保存为项目文档/项目笔记，或进入 HITAS 确认
```

关键原则：

- Skill 是执行契约，不是被动上下文提示。
- 除非用户显式选择或强制运行，系统不应因为出现“方案/报告”等泛词就自动激活某个 Skill。
- 交付物类请求优先由 `task_orchestrator` 和顾问能力目录判断是否升级为 durable task。

## 6. 顾问能力目录

代码位置：`backend/app/services/consulting_capabilities.py`

顾问能力目录与 Skill 的关系：

- Skill：用户主动选择的能力，适合有明确方法论、模板或工具组合的场景。
- Consulting Capability：后端内置的能力目录，面向自动识别高频咨询任务。

典型能力包括：

- 客户会议简报。
- 项目状态更新。
- 风险行动计划。
- 提案和交付物生成。

当 `route_project_task_request()` 判断请求需要结构化交付物或多步骤执行时，会进入 `TASK_ORCHESTRATION`，由 task orchestrator 接管，而不是继续走普通 Skill 执行。

## 7. 当前内置 Skill 版图

### 7.1 顾问基础能力

代表能力：

- 根因分析。
- 提案挑战。
- 项目启动。
- 项目复盘。
- 交付审查。
- 顾问式 PPT 生成。
- 咨询提案顾问。
- 目标定义。
- 会议纪要提取。
- Office 文档读写助手。
- Office 文档编辑。
- PDF 工具箱。

### 7.2 数字化与技术

代表能力：

- AI 用例优先级矩阵。
- 数字化成熟度评估。
- 数字化战略设计。
- 企业架构蓝图设计。
- 数据治理咨询方案。
- 流程数字化改造。
- 数字技术路线图。
- 数字化组织变革。
- 数字化 ROI 商业案例。
- 行业数字化蓝图。

### 7.3 财务、交易和企业绩效

代表能力：

- 财务健康诊断。
- 商业案例 ROI 分析。
- 绩效改进、成本优化、组织诊断等咨询场景。

## 8. 文件型 Skill 包

当前目录：

```text
skills/
├── ai-strategy-report/
├── consulting-proposal-advisor/
├── digital-strategy/
├── goal-definition/
├── meeting-intelligence/
├── office-document-editor/
├── pdf-management/
└── presentation-builder/
```

文件型 Skill 包适合存放：

- `SKILL.md`：主工作流。
- `references/`：方法论、行业参考、质量清单。
- `assets/`：模板文件，如 PPTX。
- `scripts/`：验证、生成或辅助脚本。
- `examples/`：输入样例和预期产物。

现状提醒：

- 文件型 Skill 包不是自动运行时入口。
- 需要在 `routers/skills.py` 中把必要摘要、prompt 或工具配置注册到 DB Skill。
- `consulting-proposal-advisor` 和 `digital-strategy` 已使用文件包内容增强系统 prompt。

## 9. 工具能力

常用工具：

| 工具 | 说明 | 权限倾向 |
|---|---|---|
| `read_project_file` | 列出或读取项目文件 | read-only |
| `read_project_markdown_document` | 读取 Markdown 文档 | read-only |
| `update_project_markdown_document` | 创建、追加或替换 Markdown | write / modify |
| `write_project_office_document` | 生成 DOCX/XLSX/PPTX/PDF | write |
| `edit_project_office_document` | 编辑现有 Office 文件 | modify |
| `manage_project_folders` | 管理文件夹和文件位置 | read/write/modify/delete |
| `manage_project_files` | 列表、移动、删除项目文件 | read/modify/delete |
| `manage_pdf` | PDF 合并、拆分、提取、读取、水印 | read/write/modify |
| `generate_ppt_from_skill` | 基于 Skill 生成 PPT | write |

工具可见性由 `ToolAccessPolicy` 控制，副作用权限由 `ActionPolicy` 控制。修改和删除类操作进入 HITAS 确认。

## 10. 好 Skill 的标准

一个好的 Skill 应满足：

- 任务边界清楚，不承担多个互不相关的工作。
- 输入模板能引导用户补齐关键事实。
- 输出结构稳定，便于保存、复用和审查。
- 清楚说明结果应该沉淀到哪里。
- 工具 schema 小而明确，避免模型误调。
- 对咨询交付物有完成标准，而不只是“生成一段文字”。

不建议：

- 用一个超长 system prompt 覆盖所有场景。
- 让 Skill 承担路由职责。
- 把删除、覆盖等高风险动作隐藏在普通生成流程里。
- 依赖用户手动复制大量项目上下文。

## 11. 后续工程任务

优先级建议：

1. 在现有 `ChatRun` 内容安全投影上增加按 Skill 的质量趋势和版本维度统计，不保存原始输入或工具参数。
   - 状态：已完成。项目质量面板按精确版本/包指纹汇总运行数、完成率、分类反馈、错误 Skill 原因、修订效果与启用来源；聚合不读取消息正文、自由文本或用户身份。
2. 在已落地的正式 semver/status/快照字段上增加灰度流量分配和一键回滚。
   - 状态：已完成。包含不可变发布历史、项目级稳定分桶、管理员暂停/恢复/推广/回滚、并发陈旧保护和失败率自动止损。
3. 为其余核心 Skill 增加 golden examples。
4. 增加 `verification_steps`，让交付物生成后可自动校验。
   - 状态：第三阶段已完成。运行时从冻结发布中识别质量/验收/完成清单，并以 `verification_plan_sha256` 绑定精确清单；交付物持久化后由 Aria 自有只读校验器核对真实文件、非空、扩展名、内容 SHA-256 和已支持格式完整性，结果进入不可变 `ArtifactVerification` 证据账本。Skill 的语义/业务验收项保持 `manual_required`，但现在可以由有写权限成员填写理由后接受或退回；最终交付门禁绑定精确文件、技术证据和验收计划，并保留 expected revision 与 append-only 审计。包内脚本、宏和代码不会被执行。
5. 设计 Skill 导入/导出格式，统一 DB Skill 与文件包 Skill 的同步方式。
