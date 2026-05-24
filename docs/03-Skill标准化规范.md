# Skill 标准化规范

> 更新日期：2026-05-24  
> 关联文档：[02-Skill体系](./02-Skill体系.md)

## 1. 文档定位

本文定义新增、修改和维护 AriaAI Skill 的标准流程。

当前系统的真实实现是“数据库 Skill 为运行时主体，文件型 Skill 包为方法论资产”。因此，新增 Skill 时必须同时考虑：

- 是否需要在数据库种子中出现。
- 是否需要文件包承载完整 prompt、references、模板和脚本。
- 是否需要新工具或复用已有工具。
- 是否需要前端入口、项目/客户上下文启动和保存回流。

## 2. 标准资产结构

推荐每个复杂 Skill 都有一个文件包：

```text
AriaAI/skills/{skill-slug}/
├── SKILL.md
├── references/
├── assets/
├── scripts/
└── examples/
```

目录说明：

| 路径 | 是否必需 | 说明 |
|---|---|---|
| `SKILL.md` | 必需 | 主 prompt、工作流、输出格式和规则 |
| `references/` | 可选 | 方法论、行业知识、质量清单 |
| `assets/` | 可选 | PPTX、DOCX、XLSX 等模板 |
| `scripts/` | 可选 | 生成、验证、转换脚本 |
| `examples/` | 推荐 | 输入样例和预期输出 |

## 3. SKILL.md 模板

```markdown
---
name: SKILL_NAME_CONSTANT
marker: skill_marker
description: 一句话说明 Skill 的职责
model: optional-model-id
max_tokens: 8192
---

# Skill: 中文名

## When To Use
说明什么场景应该使用这个 Skill。

## Inputs
列出用户需要提供的最小输入，以及可以从项目/客户上下文自动补齐的输入。

## Tools
列出允许使用的工具名称，并说明触发条件。

## Workflow
给模型的步骤化工作流。步骤必须可执行、可检查、可中断。

## Output Format
定义输出格式、文件类型、文件名、保存位置和结果摘要。

## Verification
定义交付物完成后的检查项。

## Usage Examples
给出 1-3 个典型输入和期望行为。

## Important Rules
列出硬约束、禁止行为、风险动作和 HITAS 触发条件。
```

## 4. 命名规范

| 对象 | 格式 | 示例 |
|---|---|---|
| 文件包目录 | kebab-case | `meeting-intelligence` |
| frontmatter `name` | 大写常量或稳定中文名，需与注册代码一致 | `MEETING_INTELLIGENCE` 或 `会议纪要提取` |
| frontmatter `marker` | snake_case 或 kebab-case，需稳定 | `meeting_intelligence` / `meeting-intelligence` |
| DB Skill `name` | 用户可见名称 | `会议纪要提取` |
| 常量名 | `UPPER_SNAKE_CASE` | `MEETING_INTELLIGENCE_SKILL_NAME` |
| 工具名 | snake_case | `write_project_office_document` |

保持稳定的字段：

- DB Skill `name`：前端展示和历史数据可能依赖。
- package slug：文件路径和 prompt 加载依赖。
- marker：用于 prompt 识别、调试和日志。

## 5. 后端注册流程

### 5.1 增加常量

文件：`AriaAI/backend/app/routers/skills.py`

```python
MEETING_INTELLIGENCE_SKILL_NAME = "会议纪要提取"
MEETING_INTELLIGENCE_PROMPT_MARKER = "meeting-intelligence workflow"
MEETING_INTELLIGENCE_TOOL_NAMES = [
    "update_project_markdown_document",
    "write_project_office_document",
]
```

### 5.2 增加种子定义

把 Skill 加入 `GSTACK_PRO_SKILLS` 或合适的内置 Skill 列表。

必填字段：

```python
{
    "name": MEETING_INTELLIGENCE_SKILL_NAME,
    "category": "顾问基础能力",
    "description": "从会议材料中提取纪要、决策、行动项和风险。",
    "system_prompt": "...",
    "user_template": "...",
    "estimated_time": "~10 min",
    "max_tokens": 8192,
    "tools": MEETING_INTELLIGENCE_TOOL_NAMES,
}
```

如果 Skill prompt 很长，优先用文件包：

```python
"system_prompt": _load_skill_package_prompt(
    "meeting-intelligence",
    ["quality-checklist.md"],
)
```

### 5.3 注册或复用工具

工具应通过 `app.tools.registry` 注册。新增工具应放在 `AriaAI/backend/app/tools/`。

工具要求：

- 有明确 `name`。
- 有自然语言 `description`。
- 有 JSON schema `input_schema`。
- 必填参数放入 `required`。
- 对项目文件路径、项目 ID、权限和文件类型做服务端校验。
- 会修改或删除数据的工具必须能被 `ActionPolicy` 和 HITAS 正确识别。

### 5.4 确保工具被导入

`AriaAI/backend/main.py` 通过 side-effect 导入工具模块。新增工具后必须确保它被启动入口导入，否则 registry 中不会有该工具。

当前已导入：

```python
from app.tools import file_generators
from app.tools import office_documents
from app.tools import pdf_translation
from app.tools import pdf_tools
```

如新增 `app/tools/my_tool.py`，需要在入口或聚合模块中导入。

## 6. 前端接入流程

当前前端主要从 `/skills` 获取 Skill 数据，页面位于：

```text
aria-web/src/pages/skills/
```

接入要求：

- Skill 列表应能展示名称、分类、描述、预计耗时。
- 从项目空间启动时，应携带 `project_id`，并在返回 Chat 时保留上下文。
- 从客户空间启动时，应携带客户档案和关联项目信息；如需要项目执行，应落到具体项目 Chat。
- 文件生成、修改和删除结果应在 Chat 工具卡或生成物卡中可见。
- 修改/删除类动作必须显示 HITAS Action Preview，而不是静默执行。

## 7. 工具权限分级

| 权限级别 | 典型工具 | 说明 |
|---|---|---|
| `READ_ONLY_TOOL` | `read_project_file`、`read_project_markdown_document` | 只读取上下文和文件 |
| `WRITE_ARTIFACT` | `write_project_office_document`、`generate_ppt_from_skill` | 新建交付物或新增内容 |
| `MODIFY_EXISTING_FILE` | `update_project_markdown_document` replace/append、`edit_project_office_document` | 修改既有文件，需 HITAS |
| `DESTRUCTIVE_ACTION` | `manage_project_files delete`、`manage_project_folders delete` | 删除或破坏性操作，需 HITAS |

Skill 设计时必须写清楚：

- 什么时候只读。
- 什么时候新建。
- 什么时候修改现有文件。
- 什么时候必须由用户确认。

## 8. 常用 Skill 与工具映射

| Skill | 工具 | 主要输出 |
|---|---|---|
| 目标定义 | `update_project_markdown_document`、`write_project_office_document` | OKR/SMART 目标、行动计划 |
| 会议纪要提取 | `update_project_markdown_document`、`write_project_office_document` | 会议纪要、行动项、决策清单 |
| Office 文档编辑 | `read_project_file`、`edit_project_office_document`、`write_project_office_document`、`manage_project_files` | 编辑或生成 Office 文件 |
| PDF 工具箱 | `read_project_file`、`manage_pdf` | PDF 合并、拆分、提取、读取、水印 |
| 顾问式 PPT 生成 | `generate_ppt_from_skill` | PPTX |
| 咨询提案顾问 | `generate_ppt_from_skill`、`read_project_file`、`write_project_office_document` | 提案、PPT、SOW、商业案例 |
| 数字化战略设计 | `generate_ppt_from_skill` | 数字化战略 PPT |

## 9. 输出规范

交付物类 Skill 必须定义：

- 输出文件类型：`.md`、`.pptx`、`.docx`、`.xlsx`、`.pdf`。
- 文件名规则：包含项目名、主题、日期或版本。
- 保存位置：项目空间默认文件夹或指定 folder。
- 摘要：不超过 30 个中文字符，便于项目空间展示。
- 成功回复：说明文件名、格式、所在位置和下一步。
- 失败回复：说明失败原因、是否可重试、用户可采取的动作。

## 10. Verification 规范

复杂 Skill 必须提供验证清单。示例：

```markdown
## Verification
- PPTX 文件已生成并注册到项目空间。
- 包含执行摘要、现状诊断、目标蓝图、差距路线图、治理与投资五个章节。
- 每页标题为结论句，不只是主题名。
- 至少包含一个路线图页和一个风险缓释页。
- 若验证失败，优先修复产物，不要求用户重新输入。
```

当前系统尚未完全实现通用 `verification_steps` 字段，但新增 Skill 应先在文件包中写清楚，为后续自动校验做准备。

## 11. 审核清单

新增或修改 Skill 前检查：

- [ ] 有清晰任务边界。
- [ ] `SKILL.md` frontmatter 完整。
- [ ] DB 种子和文件包名称一致。
- [ ] 输入模板不会要求用户重复填写系统已有上下文。
- [ ] 工具列表最小化。
- [ ] 工具 schema 有服务端校验。
- [ ] 修改和删除动作会进入 HITAS。
- [ ] 输出格式可保存、可复用、可审查。
- [ ] 有至少一个 usage example。
- [ ] 复杂交付物有 verification 清单。
- [ ] 增加或更新相关测试。

## 12. 维护约定

- Prompt 调优优先改文件包 `SKILL.md`，再同步必要摘要到 DB 种子。
- 新增工具必须补充工具权限和 HITAS 触发规则。
- 删除 Skill 时优先停用或从种子移除，不直接破坏历史数据。
- 修改已有 Skill 的工具集时，同步更新文档、测试和前端展示。
- 内置 Skill 的 `estimated_time`、`category`、`description` 应面向顾问用户，而不是面向开发者。
