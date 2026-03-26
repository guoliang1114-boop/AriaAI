# AriaAI (ConsultantAI)

> 面向咨询顾问的 AI 原生工作台 —— 不止聊天，搞定一切

---

## 🚀 快速启动

```bash
# Terminal 1 — 启动后端
cd ConsultantAI/backend
./start.sh

# Terminal 2 — 启动 macOS 应用
cd ConsultantAI
swift run
```

---

## 📚 文档导航

所有文档已整理到 `docs/` 目录，按阅读顺序编号：

| 编号 | 文档 | 说明 | 目标读者 |
|------|------|------|----------|
| [00-项目总览](docs/00-项目总览.md) | 技术架构、代码结构、API 说明 | 开发者必读 |
| [01-产品设计文档](docs/01-产品设计文档.md) | 产品定位、功能设计、路线图 | 产品经理、设计师 |
| [02-Skill开发指南](docs/02-Skill开发指南.md) | 如何开发新 Skill | Skill 开发者 |
| [03-代码问题清单](docs/03-代码问题清单.md) | 已知问题和待修复项 | 维护开发者 |

---

## 🏗️ 项目结构

```
AP/
├── docs/                    # 📚 项目文档
│   ├── 00-项目总览.md
│   ├── 01-产品设计文档.md
│   ├── 02-Skill开发指南.md
│   └── 03-代码问题清单.md
├── ConsultantAI/            # 💻 主应用代码
│   ├── ConsultantAI/        # SwiftUI 前端
│   ├── backend/             # Python FastAPI 后端
│   └── skills/              # Skill 定义
├── AppIcons/                # 🎨 应用图标
└── README.md                # 本文档
```

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | SwiftUI (macOS 14+) |
| **后端** | Python 3.9 + FastAPI |
| **数据库** | PostgreSQL |
| **LLM** | Anthropic Claude API |
| **向量化** | sentence-transformers |

---

## 📖 推荐阅读顺序

### 对于新加入的开发者：
1. 先读 [00-项目总览](docs/00-项目总览.md) 了解系统架构
2. 再读 [01-产品设计文档](docs/01-产品设计文档.md) 理解产品逻辑
3. 根据工作方向选择：
   - 开发 Skill → [02-Skill开发指南](docs/02-Skill开发指南.md)
   - 维护代码 → [03-代码问题清单](docs/03-代码问题清单.md)

### 对于 LLM/AI 助手：
- 直接阅读 [00-项目总览](docs/00-项目总览.md) 即可获取完整上下文

---

## 🤝 协作规范

- **代码提交**: 遵循 Conventional Commits 规范
- **文档更新**: 修改代码时同步更新相关文档
- **问题追踪**: 新发现的问题添加到 [03-代码问题清单](docs/03-代码问题清单.md)

---

*最后更新: 2026-03-26*
