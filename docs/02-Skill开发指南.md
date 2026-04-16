# AriaAI Skill 开发指南

更新日期：2026-04-17

适用范围：当前仓库中的数据库 Skill 模型、后端 Skill 接口、工具注册机制，以及前端/聊天侧的实际接入方式。

---

## 1. 先说结论

在当前代码里，Skill 不是一个独立插件目录，而是一条数据库记录。

也就是说，当前系统的 Skill 体系本质上是：

- 用数据库表保存 Skill 定义
- 用后端接口做 CRUD 管理
- 用 `system_prompt + user_template + tools_definition_json` 组合出能力
- 在聊天链路里按 Skill 配置决定提示词和可用工具

当前最关键的相关代码：

- `AriaAI/backend/app/models/db.py`
- `AriaAI/backend/app/routers/skills.py`
- `AriaAI/backend/app/tools/__init__.py`

---

## 2. 当前 Skill 数据模型

`Skill` 模型定义在：

- `AriaAI/backend/app/models/db.py`

当前核心字段如下：

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `name` | Skill 名称 |
| `category` | 分类，当前仍是自由文本 |
| `description` | 简介 |
| `system_prompt` | 系统提示词 |
| `user_template` | 默认用户输入模板 |
| `estimated_time` | 预计耗时描述 |
| `max_tokens` | 当前默认 `4096` |
| `tools_definition_json` | 新版工具定义，使用完整 schema |
| `tools_json` | 旧版兼容字段，保存简单工具名列表 |

当前模型还保留了两个属性封装：

- `tools`
  - 读写 `tools_json`
  - 用于兼容旧版“仅保存工具名列表”的写法
- `tools_definition`
  - 读写 `tools_definition_json`
  - 用于当前推荐的完整工具 schema 写法

建议理解为：

- `tools_definition_json` 是现在应该优先使用的正式字段
- `tools_json` 只是兼容层，不建议继续作为主要配置方式扩展新能力

---

## 3. Skill 相关接口

当前路由定义在：

- `AriaAI/backend/app/routers/skills.py`

当前可以确认的基础接口有：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/skills` | 获取 Skill 列表，可按 `category` 过滤 |
| `POST` | `/skills` | 创建 Skill |
| `PATCH` | `/skills/{skill_id}` | 更新 Skill |
| `DELETE` | `/skills/{skill_id}` | 删除 Skill |

创建与更新时当前主要使用这些字段：

### 创建 `SkillCreate`

- `name`
- `category`
- `description`
- `system_prompt`
- `user_template`
- `estimated_time`
- `tools_definition_json`

### 更新 `SkillUpdate`

- `name`
- `description`
- `system_prompt`
- `user_template`
- `estimated_time`
- `tools_definition_json`

注意点：

- 当前 `PATCH` 没有单独暴露 `category` 更新字段，如果要支持分类编辑，需要补接口字段
- `list_skills` 结果带了 TTL 缓存，Skill 变更后会自动清理缓存

---

## 4. 当前工具注册机制

工具注册中心定义在：

- `AriaAI/backend/app/tools/__init__.py`

当前注册中心核心职责：

1. 注册工具
2. 暴露工具 schema
3. 执行工具
4. 返回统一格式的工具执行结果

当前工具注册的核心格式是：

```python
registry.register(
    name="generate_ppt",
    description="Generate a PowerPoint presentation",
    input_schema={...},
)
```

注册后，`get_schemas()` 会返回适合大模型工具调用的结构，核心字段是：

- `name`
- `description`
- `input_schema`

工具执行结果当前会被包装为类似结构：

```json
{
  "type": "tool_result",
  "tool_name": "generate_ppt",
  "status": "success",
  "output": {}
}
```

如果执行失败，会返回同结构的错误信息，而不是直接把后端异常原样抛给上层聊天逻辑。

---

## 5. 推荐的 Skill 工具定义格式

当前推荐直接写 `tools_definition_json`，使用完整 schema。

推荐格式：

```json
[
  {
    "name": "generate_ppt",
    "description": "Generate a PowerPoint presentation",
    "input_schema": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "slides": { "type": "array" }
      },
      "required": ["title", "slides"]
    }
  }
]
```

不要再优先依赖这种旧式格式：

```json
["generate_ppt", "save_text"]
```

原因很简单：

- 完整 schema 更容易校验
- 更适合模型做参数构造
- 后续接入前端可视化、测试和工具治理也更稳

---

## 6. 一个最小可用 Skill 示例

下面这个结构已经足够创建一个可工作的数据库 Skill：

```json
{
  "name": "Executive Summary",
  "category": "项目交付",
  "description": "将复杂资料压缩成管理层可快速理解的执行摘要。",
  "system_prompt": "你是一名资深咨询顾问，请输出结构清晰、行动导向的执行摘要。",
  "user_template": "请基于以下资料生成执行摘要：\n\n项目背景：\n目标读者：\n核心问题：\n输入材料：",
  "estimated_time": "~2 min",
  "tools_definition_json": "[]"
}
```

如果 Skill 需要生成文档、PPT、Excel 或其他产物，再把对应工具 schema 填到 `tools_definition_json`。

---

## 7. 当前推荐的 Skill 编写方式

### 7.1 Prompt 层

建议顺序：

1. 先写角色
2. 再写任务目标
3. 再写输出结构
4. 最后补限制条件

比起写“请详细分析”，更推荐明确指定输出结构，例如：

- 背景
- 关键发现
- 建议
- 风险
- 下一步

### 7.2 Template 层

`user_template` 最好像一个轻量表单，而不是一大段自由文本说明。

推荐写法：

```text
项目名称：
目标受众：
本次任务目标：
已有材料：
输出偏好：
```

这样做的好处：

- 用户更容易填
- 前端更容易做预填或结构化扩展
- 模型输入更稳定

### 7.3 Tool 层

工具定义尽量做到：

- 一个工具只做一类事
- 输入 schema 小而稳
- 名称和用途一一对应
- 不把多个阶段动作塞进一个巨型工具

坏例子：

- 一个工具同时负责“搜索、整理、生成 PPT、保存文件、发送邮件”

好例子：

- `research_market`
- `generate_ppt`
- `save_text`

---

## 8. 当前与项目空间的关系

当前代码里，Skill 已经能存在于聊天体系中，但“项目页直接用 Skill”的体验还没有完全做通。

现状是：

- `Conversation` 模型里已经有 `skill_id`
- 项目聊天已经有项目上下文能力
- 通用 Skill 管理已存在

但仍缺的关键一环是：

- 项目聊天页上的 Skill 选择器
- Skill 模板与当前项目上下文自动联动
- Skill 结果一键沉淀为项目文档/笔记/生成物

这也是接下来最值得继续推进的一条线。

---

## 9. 建议的开发流程

### 新建一个 Skill

1. 先定义目标用户和交付结果
2. 写 `system_prompt`
3. 写 `user_template`
4. 如需工具，再补 `tools_definition_json`
5. 通过 `/skills` 创建
6. 在聊天链路里做一次真实验证

### 修改一个已有 Skill

1. 先确认它当前是否仍依赖旧 `tools_json`
2. 优先迁移到 `tools_definition_json`
3. 避免只改文案、不改输出结构
4. 修改后重新验证工具调用是否仍稳定

---

## 10. 当前已知不足

基于现有代码，Skill 系统还有这些明显可优化点：

- `category` 仍是自由文本，缺少统一枚举
- Skill 缺少版本号、状态流转和发布机制
- Skill 的导入/导出还没有标准格式
- 项目聊天页尚未完整接入 Skill 选择与执行
- Skill 测试与回归保护仍偏轻，更多依赖人工验证

---

## 11. 建议的下一步

如果后续继续沿 Skill 方向推进，建议优先顺序如下：

1. 让项目聊天页支持 Skill 选择
2. 让 Skill 自动携带项目上下文执行
3. 让 Skill 结果一键沉淀为项目笔记、项目文档或生成物
4. 给 Skill 增加更正式的分类、版本和验证机制

到这一步，Skill 才会从“可配置提示词”真正升级为“项目工作流能力模块”。
