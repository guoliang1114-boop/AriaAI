# ConsultantAI 工作台 — 功能清单 & 开发状态

> 更新于 2026-03-21
> 架构：SwiftUI (macOS 13+) + Python FastAPI + SQLite + Claude API

---

## 图例

| 符号 | 含义 |
|------|------|
| ✅ | 已完成，可运行 |
| 🟡 | 部分实现，UI 完成但未接真实数据 |
| 🔲 | 规划中，尚未开始 |

---

## 一、前端 SwiftUI

### 1. 登录 / 认证
| 功能 | 状态 | 备注 |
|------|------|------|
| 登录页 UI（邮箱 + 密码 + SSO 按钮） | ✅ | `LoginView.swift` |
| 假登录（0.8s 延迟 → 进入主界面） | ✅ | 直接跳过 auth |
| 真实认证（JWT / API Key 验证） | 🔲 | M13 计划中 |
| 登出 | ✅ | Sidebar Sign Out 按钮 |

### 2. 侧边栏 / 导航
| 功能 | 状态 | 备注 |
|------|------|------|
| 侧边栏 UI（品牌 Logo、Nav Items、底部菜单） | ✅ | `SidebarView.swift` |
| Pill 高亮 active 状态 + Hover 动画 | ✅ | |
| New Workstream 按钮 → 跳转 Chat | ✅ | |
| 7 个导航项全部可跳转 | ✅ | |

### 3. 对话工作区（Chat）
| 功能 | 状态 | 备注 |
|------|------|------|
| 聊天 UI（气泡、AI 头像、输入框、工具栏） | ✅ | `ChatView.swift` |
| SSE 流式接收 Claude 响应 | ✅ | 实时 chunk 更新 |
| 流式光标（streaming row） | ✅ | 边收边显示 |
| 对话 ID 持久化（跨消息保持 conversation） | ✅ | |
| 历史消息加载（从 DB 恢复） | 🔲 | UI 未实现加载旧会话 |
| @ 技能注入（选择 Skill → 注入 system prompt） | 🟡 | 后端支持，UI 仅显示 pill，未做选择器 |
| # 文档 RAG 注入（`#doc` 触发检索） | ✅ | 后端自动检测 `#doc` |
| 附件上传（paperclip） | 🔲 | 按钮存在，功能未实现 |
| Insight Card 展示 | 🟡 | UI 组件完成，AI 响应未结构化解析 |
| 会话列表（DRAFTS / SHARED / ARCHIVED tabs） | 🟡 | Tab UI 存在，未接会话列表数据 |
| 会话标题自动生成 | ✅ | 后端截取首条消息前 50 字 |

### 4. 项目空间（Projects）
| 功能 | 状态 | 备注 |
|------|------|------|
| 项目卡片网格 UI | ✅ | `ProjectsView.swift` |
| ACTIVE / ARCHIVED 筛选 Tab | ✅ | |
| 从 DataStore 加载真实项目 | ✅ | 后端有数据时替换 SampleData |
| New Project（创建项目） | 🔲 | 按钮存在，无弹窗/表单 |
| 项目详情页（ProjectSpaceView） | ✅ | `ProjectSpaceView.swift` |
| 项目里程碑（勾选、优先级） | ✅ | UI 完整 |
| 里程碑 CRUD（持久化） | 🟡 | 后端 API 完成，UI 未调用 |
| 文件库（FileChip 展示） | ✅ | UI 完整 |
| 文件上传 | 🟡 | 后端 API 完成，UI 未实现拖拽/选择 |
| 项目上下文注入 Chat | ✅ | 通过 `selectedProject` → `project_id` |
| 项目删除 | 🔲 | 后端 API 完成，UI 无入口 |

### 5. 知识库（KnowledgeBase）
| 功能 | 状态 | 备注 |
|------|------|------|
| 文档列表 UI（表格 + Vector Status） | ✅ | `KnowledgeBaseView.swift` |
| 从 DataStore 加载真实文档 | ✅ | |
| 拖拽上传区 UI | ✅ | 样式完成 |
| 实际拖拽/点击上传文件 | 🔲 | 无 `onDrop` / `fileImporter` 实现 |
| RAG 过滤器 Chip（添加/删除） | ✅ | 本地状态，未持久化 |
| 存储用量 ProgressBar | ✅ | 固定值，未接真实统计 |
| 向量数量统计 | 🟡 | 后端 `/knowledge/stats` 完成，UI 未调用 |
| 右侧面板（Insights、RAG 过滤器） | ✅ | |

### 6. 技能中心（Skills）
| 功能 | 状态 | 备注 |
|------|------|------|
| 技能卡片 UI（Quick Tool / Deep Task 分组） | ✅ | `SkillsView.swift` |
| 搜索过滤 | ✅ | 本地过滤 |
| 从 DataStore 加载真实技能 | ✅ | 首次自动 seed 6 个默认技能 |
| Use Skill（打开 Chat 并注入 system prompt） | 🔲 | 按钮存在，未实现导航 + skill_id 传递 |
| Assign to Project | 🔲 | 按钮存在，功能未实现 |
| 自定义新技能（CRUD） | 🔲 | 后端 API 完成，UI 无创建入口 |

### 7. 定时任务（Schedules）
| 功能 | 状态 | 备注 |
|------|------|------|
| 任务列表 UI（表格 + Toggle） | ✅ | `SchedulesView.swift` |
| 从 DataStore 加载真实任务 | ✅ | |
| Toggle 启用/禁用（UI 本地） | ✅ | |
| Toggle 同步到后端 | 🔲 | `dataStore.toggleTask()` 已写，UI Toggle 未绑定 |
| 新建任务弹窗 | 🔲 | 按钮存在，无表单 |
| 立即执行（Run Now） | 🔲 | 后端 API 完成，UI 无按钮 |
| 执行日志查看 | 🔲 | 未实现 |

### 8. 模板库（Templates）
| 功能 | 状态 | 备注 |
|------|------|------|
| 模板卡片网格 UI | ✅ | `TemplatesView.swift` |
| 渐变缩略图（hash 配色） | ✅ | |
| Recent Activity 表格 | ✅ | 静态数据 |
| 从 DataStore 加载真实模板 | ✅ | |
| Upload Template（文件上传） | 🔲 | 按钮存在，无实现 |
| Assign to Project | 🔲 | 按钮存在，功能未实现 |

### 9. 设置（Settings）
| 功能 | 状态 | 备注 |
|------|------|------|
| 设置页 UI（API、本地模型、数据安全） | ✅ | `SettingsView.swift` |
| API Key 输入 + 明文/密文切换 | ✅ | |
| 保存 API Key → Keychain（通过后端） | ✅ | `dataStore.saveApiKey()` |
| API Key 状态显示（已配置/未配置） | ✅ | |
| 模型选择 Picker | ✅ | 本地状态，未持久化到后端 |
| Dynamic Routing Toggle | 🟡 | 本地状态，未持久化 |
| 本地模型状态（Ollama） | 🟡 | 固定展示，未真实检测 |

---

## 二、后端 FastAPI

### 基础设施
| 功能 | 状态 | 备注 |
|------|------|------|
| FastAPI 应用 + CORS | ✅ | `main.py` |
| SQLite + SQLModel ORM | ✅ | `database.py` |
| 10 张数据库表 | ✅ | `models/db.py` |
| 启动脚本（自动 venv + 安装依赖） | ✅ | `start.sh` |
| 热重载（uvicorn --reload） | ✅ | |
| APScheduler 后台调度器 | ✅ | 随 app 启动/关闭 |

### Chat 路由 `/chat`
| 功能 | 状态 | 备注 |
|------|------|------|
| POST `/chat/send` SSE 流式响应 | ✅ | |
| 自动创建 Conversation | ✅ | |
| 会话历史持久化（Message 表） | ✅ | |
| 会话标题自动生成 | ✅ | |
| Skill system prompt 注入 | ✅ | |
| Project 上下文注入 | ✅ | |
| RAG `#doc` 自动触发 | ✅ | |
| GET `/chat/conversations` | ✅ | |
| DELETE `/chat/conversations/{id}` | ✅ | |

### Projects 路由 `/projects`
| 功能 | 状态 | 备注 |
|------|------|------|
| CRUD 项目 | ✅ | |
| CRUD 里程碑 | ✅ | |
| 文件上传 / 删除 | ✅ | 存储到 `data/uploads/projects/` |

### Knowledge 路由 `/knowledge`
| 功能 | 状态 | 备注 |
|------|------|------|
| 文档上传（PDF/DOCX/XLSX） | ✅ | |
| 后台异步向量索引 | ✅ | BackgroundTasks |
| 文档解析（pdfplumber / python-docx） | ✅ | `parser.py` |
| 文本分块（chunk + overlap） | ✅ | `rag.py` |
| 嵌入（sentence-transformers） | ✅ | `all-MiniLM-L6-v2` |
| 余弦相似度检索 Top-K | ✅ | |
| 文档删除（含清理 chunks） | ✅ | |
| GET `/knowledge/stats` | ✅ | |

### Skills 路由 `/skills`
| 功能 | 状态 | 备注 |
|------|------|------|
| CRUD 技能 | ✅ | |
| POST `/skills/seed`（默认 6 个技能） | ✅ | |

### Schedules 路由 `/schedules`
| 功能 | 状态 | 备注 |
|------|------|------|
| CRUD 任务 | ✅ | |
| APScheduler 注册/更新/删除 | ✅ | |
| POST `/schedules/{id}/run`（立即触发） | ✅ | |
| 任务执行 → 保存为 Conversation | ✅ | `task_runner.py` |

### Templates 路由 `/templates`
| 功能 | 状态 | 备注 |
|------|------|------|
| 模板上传（PPTX/DOCX/PDF） | ✅ | |
| CRUD 模板（更新 tags、status） | ✅ | |

### Settings 路由 `/settings`
| 功能 | 状态 | 备注 |
|------|------|------|
| API Key 存取（macOS Keychain） | ✅ | |
| GET `/settings/api-key-status` | ✅ | |
| KV 设置存储（Setting 表） | ✅ | |

---

## 三、SwiftUI ↔ 后端集成层

| 功能 | 状态 | 备注 |
|------|------|------|
| `APIClient.swift`（actor，get/post/patch/delete） | ✅ | |
| SSE 流式读取（`AsyncThrowingStream`） | ✅ | |
| 文件 multipart 上传 helper | ✅ | |
| `APIModels.swift`（Codable 响应模型 + 转换） | ✅ | |
| `DataStore.swift`（`@MainActor ObservableObject`） | ✅ | |
| 启动时 `loadAll()`（并发加载所有数据） | ✅ | |
| SampleData 兜底（后端离线时保持 UI 可用） | ✅ | |

---

## 四、近期优先开发项（建议顺序）

| 优先级 | 功能 | 说明 |
|--------|------|------|
| ✅ P0 | 文件上传 UI（知识库 + 项目） | `fileImporter` + 调用后端 upload API |
| ✅ P0 | Use Skill → Chat 导航 | 点击技能 → 切换到 Chat 并设置 `skill_id` |
| 🟠 P1 | 会话列表 UI（历史对话） | Chat 侧边或 DRAFTS tab 展示 conversations |
| 🟠 P1 | 新建项目弹窗 | Sheet + 表单 → `dataStore.createProject()` |
| 🟠 P1 | 定时任务 Toggle 同步后端 | 绑定 `dataStore.toggleTask(apiId:enabled:)` |
| 🟡 P2 | 新建定时任务表单 | Sheet + 频率选择器 |
| 🟡 P2 | 向量统计接真实数据 | 调用 `/knowledge/stats` |
| 🟡 P2 | 模型选择持久化 | `PUT /settings/model` |
| 🟢 P3 | ⌘+K 全局搜索 | 跨项目/对话/文档搜索 |
| 🟢 P3 | 真实身份认证 | API Key 作为登录凭证 |
| 🟢 P3 | PPTX 模板自动填充 | python-pptx 生成报告 |
