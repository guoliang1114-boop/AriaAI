# Skill 标准化规范

> 创建日期：2026-05-23
> 更新日期：2026-05-23
> 关联：[01-Skill体系.md](./01-Skill体系.md)
>
> **定位**：这份文档是 Skill 的**单一信源（Single Source of Truth）**。新增 Skill、修改 Skill 工具集、调整 Skill 注入逻辑，都以本文档为准。

---

## 核心原则

**Skill = 文件化 Prompt + 可注册常量 + 工具映射**

```
SKILL.md（文件化 prompt）
   ↓
services/skills/ 常量 + seed 数据
   ↓
backend 路由注册
   ↓
frontend Tool Panel 挂载
   ↓
模型 system prompt 中注入
```

---

## 标准格式

### SKILL.md 模板

每个 Skill 目录下的 `SKILL.md` 必须包含以下 frontmatter + 章节：

```markdown
---
name: skill-name-constant-case
marker: skill_marker_snake_case
description: 一句话描述 Skill 的职责
model: gpt-4o-mini   # 可选，默认使用用户设置
max_tokens: 4096     # 可选
---

# Skill: Skill 中文名

## When To Use
在什么场景下应该 arm 这个 Skill。面向用户描述（也会在 frontend Skill 卡片中展示）。

## Tools
Skill 需要调用的工具列表（backend 常量中注册）。

## Workflow
Skill 的工作流步骤，面向模型描述（注入到 system prompt）。

## Output Format
Skill 产出物的格式规范。特别是文件输出类的 Skill，必须明确：
- 文件类型（.md / .pptx / .docx / .xlsx / .pdf）
- 文件名命名规范
- 存放路径

## Usage Examples
1-3 个典型对话示例，说明用户说什么、模型应该做什么。

## Important Rules
1. 模型的行为约束（"不"做什么）
2. 模型必须调用特定工具的触发条件
3. 输出格式必须遵循的模板
```

### SKILL.md 命名约束

| 属性 | 格式 | 示例 |
|---|---|---|
| `name` | `SNAKE_CASE`，全大写下划线分隔 | `MEETING_INTELLIGENCE` |
| `marker` | `snake_case`，小写下划线分隔 | `meeting_intelligence` |
| `description` | 一句话，≤60 字 | "智能识别与生成会议纪要" |
| `model` | 可选，OpenAI 模型 ID | `gpt-4o-mini` |
| `max_tokens` | 可选，整数 | `4096` |

---

## 后端注册流程

### Step 1: 创建常量

在 `AriaAI/backend/app/routers/skills.py` 中添加：

```python
# ── SKILL 常量 ──────────────────────────────────
GOAL_DEFINITION_SKILL_NAME = "GOAL_DEFINITION"
GOAL_DEFINITION_MARKER = "goal_definition"
GOAL_DEFINITION_TOOL_NAMES = ["update_project_markdown_document", "write_project_office_document"]
```

### Step 2: 注册映射

在同一个文件中：

```python
SKILL_NAME_TO_MARKER: dict[str, str] = {
    # ... existing entries ...
    GOAL_DEFINITION_SKILL_NAME: GOAL_DEFINITION_MARKER,
}

SKILL_NAME_TO_TOOLS: dict[str, list[str]] = {
    # ... existing entries ...
    GOAL_DEFINITION_SKILL_NAME: GOAL_DEFINITION_TOOL_NAMES,
}
```

### Step 3: 种子数据

在 `GSTACK_PRO_SKILLS` 列表中添加：

```python
{
    "name": GOAL_DEFINITION_SKILL_NAME,
    "category": "Operations",
    "description": "智能目标拆解与进度追踪",
    "color": "#3B82F6",  # Tailwind blue-500
    "icon": "Target",
    "sort_order": 500,
    "is_active": True,
    "capability_type": "COMPOSITE",
    "marker": GOAL_DEFINITION_MARKER,
    "meta": {"scope": "project", "tools": GOAL_DEFINITION_TOOL_NAMES},
},
```

> 注意：`sort_order` 决定 Skill 在前端卡片中的排序，建议间隔 100 避免插入冲突。

### Step 4: 工具注册

如果 Skill 需要新工具，在 `AriaAI/backend/app/tools/` 下创建新文件：

```python
# my_new_tool.py
from app.tools.tool_registry import registry

MY_NEW_TOOL_NAME = "my_new_tool"

@registry.register(
    name=MY_NEW_TOOL_NAME,
    description=tool_description(
        MY_NEW_TOOL_NAME,
        "用自然语言描述这个工具做什么",
        {
            "project_id": {"type": "integer", "description": "项目 ID"},
            "input_param": {"type": "string", "description": "输入参数"},
        },
        required=["project_id", "input_param"],
    ),
)
async def my_new_tool(*, project_id: int, input_param: str) -> dict[str, Any]:
    # 工具实现
    return {"success": True, "result": "..."}
```

然后在 `AriaAI/backend/app/tools/main.py` 中导入（仅 side-effect 注册）：

```python
from app.tools import my_new_tool  # noqa: F401
```

### Step 5: 前端 Skill 卡片

在 `aria-web/src/constants/skills.ts`（或对应位置）添加 Skill 卡片配置：

```typescript
export const GOAL_DEFINITION_SKILL: SkillCard = {
  name: 'GOAL_DEFINITION',
  displayName: '目标拆解',
  description: '智能目标拆解与进度追踪',
  icon: 'Target',
  color: '#3B82F6',
  category: 'Operations',
  toolNames: ['update_project_markdown_document', 'write_project_office_document'],
};
```

前端会自动读取 `SKILL.md` 文件作为 Skill 的详细说明（如果有的话）。

### Step 6: 更新注入逻辑

在 `services/chat/context_builder.py`（或 `prepare_chat_runtime_async`）中，确保 Skill marker 能正确注入到 system prompt：

```python
# 伪代码
if skill_marker := state.get("armed_skill_marker"):
    skill_prompt = load_skill_prompt(skill_marker)
    system_prompt_parts.append(skill_prompt)
```

---

## 工具映射表

| Skill | 工具 | 文件类型 | 权限级别 |
|---|---|---|---|
| `PROJECT_KICKOFF` | `update_project_markdown_document`, `write_project_office_document` | .md, .pptx | WRITE_ARTIFACT |
| `RISK_MANAGEMENT` | `update_project_markdown_document`, `write_project_office_document` | .md, .pptx | WRITE_ARTIFACT |
| `PROJECT_INTELLIGENCE` | `update_project_markdown_document`, `write_project_office_document` | .md, .pptx | WRITE_ARTIFACT |
| `STAKEHOLDER_MANAGEMENT` | `update_project_markdown_document` | .md | MODIFY_EXISTING_FILE |
| `PROJECT_SUMMARY` | `update_project_markdown_document`, `write_project_office_document` | .md, .pptx | WRITE_ARTIFACT |
| `GOAL_DEFINITION` | `update_project_markdown_document`, `write_project_office_document` | .md, .pptx | WRITE_ARTIFACT |
| `MEETING_INTELLIGENCE` | `update_project_markdown_document`, `write_project_office_document` | .md, .pptx | WRITE_ARTIFACT |
| `OFFICE_DOCUMENT_EDITOR` | `read_project_file`, `edit_project_office_document`, `write_project_office_document`, `manage_project_files` | .pptx, .docx, .xlsx | MODIFY_EXISTING_FILE / DESTRUCTIVE_ACTION |
| `PDF_MANAGEMENT` | `read_project_file`, `manage_pdf` | .pdf | DESTRUCTIVE_ACTION / WRITE_ARTIFACT |

---

## 批量导入流程

### 外部 Skill 接入标准

当外部贡献者提交新 Skill 时，需要按以下顺序提供：

1. **SKILL.md**（必须）：放在 `AriaAI/skills/{skill_marker}/SKILL.md`
2. **常量注册**（必须）：按 "后端注册流程 Step 1-3" 修改 `skills.py`
3. **新工具**（如需）：按 "Step 4" 创建工具文件
4. **前端卡片**（可选）：如需在 UI 展示，按 "Step 5" 添加
5. **测试用例**（推荐）：至少一个集成测试验证 Skill 能正常 arm 和调用

### 审核清单

- [ ] SKILL.md frontmatter 完整（name, marker, description）
- [ ] marker 为 `snake_case`，name 为 `SNAKE_CASE`
- [ ] 工具常量与 `SKILL_NAME_TO_TOOLS` 映射一致
- [ ] 种子数据 `sort_order` 不冲突
- [ ] 文件类 Skill 有明确的 Output Format 章节
- [ ] 权限级别与工具能力匹配（write=WRITE_ARTIFACT, edit=MODIFY_EXISTING_FILE, delete=DESTRUCTIVE_ACTION）
- [ ] 工具描述清晰（模型能正确理解什么时候调用）
- [ ] 新工具有 schema 校验（`required` 字段完整）

---

## 维护约定

- **新增 Skill** → 按本规范流程，PR 需附带 SKILL.md + 常量 + 测试
- **修改 Skill 工具集** → 更新 `SKILL_NAME_TO_TOOLS` + SKILL.md Tools 章节 + 前端工具映射
- **删除 Skill** → 从 `GSTACK_PRO_SKILLS` 设置 `is_active=False`，保留常量（向后兼容）
- **工具 schema 变更** → 更新 `tool_description` 中的 schema + SKILL.md Important Rules
- **Prompt 调优** → 只改 SKILL.md 文件，不改代码中的 prompt 字符串

---

## 附录：已有 Skill 目录

```
AriaAI/skills/
├── project-kickoff/
│   └── SKILL.md
├── risk-management/
│   └── SKILL.md
├── project-intelligence/
│   └── SKILL.md
├── stakeholder-management/
│   └── SKILL.md
├── project-summary/
│   └── SKILL.md
├── goal-definition/
│   └── SKILL.md          # v1.14 新增
├── meeting-intelligence/
│   └── SKILL.md          # v1.14 新增
├── office-document-editor/
│   └── SKILL.md          # v1.14 新增
└── pdf-management/
    └── SKILL.md          # v1.14 新增
```
