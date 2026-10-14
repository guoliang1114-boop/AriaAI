# 32-个人助手App总体方案

> 更新日期：2026-10-14
> 主题：**基于 AriaAI 构建 Muse-like 个人助手 App 的总体设计**
> 关联文档：
> - [00-项目总览](./00-项目总览.md)
> - [17-Agentic Workspace产品Gap分析](./17-Agentic%20Workspace产品Gap分析.md)
> - [30-个人助手模式迭代计划](./30-个人助手模式迭代计划.md)
> - [31-语音模式技术设计](./31-语音模式技术设计.md)

## 1. 背景

AriaAI（v3.4）是已上线的 agentic workspace：streaming agent chat、tool calls、RAG、三层记忆、Skill、定时任务、HITL 审批，模型默认 Claude。目标：在这套后端上长出一个 Muse-like 的个人助手 App——手机上能用、会说话、能办生活里的事。

原则：**后端复用，端侧与工具做加法**。不重写 agent。

## 2. 目标与非目标

目标（MVP）：
- 手机上可用的个人助手：对话 + 语音（见 31）
- 生活类工具：邮件、日历、天气、提醒、网页搜索
- 个人记忆成为默认工作区（不挂靠项目）

非目标（v1 不做）：
- to-B 咨询能力的移动化（另一条线）
- 应用商店上架（先 TestFlight / PWA 验证）

## 3. 总体架构

```
[移动端] --HTTPS/WS--> [AriaAI 后端（复用）] --> [模型层 provider_selector]
   |                        |
 语音/聊天 UI          agent_harness / tools / RAG / memory / Skill / HITL / 定时
   |
 新增：生活类工具（email / calendar / weather / search / reminder）
```

## 4. 工作流一：移动端

### 4.1 选型对比

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| PWA（移动 Web） | 最快；复用现有 React 前端；免上架 | iOS 推送/后台受限 | MVP 验证用 |
| React Native | 真原生；复用 TS/React 技能；可上架 | 新工程，中等工作量 | 正式版 |
| Flutter | 性能好 | Dart 栈不复用，团队技能分裂 | 不推荐 |

推荐路线：**PWA 先跑通 → React Native 正式版**。v1 不写原生。

### 4.2 范围

- 响应式聊天 UI（复用 web/）
- PWA：manifest、service worker（离线壳）、推送（APNs/FCM 经后端）
- 语音 UI（见 31）

## 5. 工作流二：生活类工具

现有工具偏办公交付（PPT/Word/PDF）。新增（走现有 tool 注册机制）：

| 工具 | 说明 |
|---|---|
| email | 收发邮件（Gmail 起步） |
| calendar | 查 / 建日程 |
| weather | 天气查询 |
| reminder | 提醒 → 复用定时任务 |
| web_search | 网页搜索 |

每个工具独立 PR；HITL：发邮件、删日程等高风险操作走确认卡（见 06 设计）。

## 6. 工作流三：语音模式

见 [31-语音模式技术设计](./31-语音模式技术设计.md)。App 端的语音 UI 在本方案 4.2 范围内。

## 7. 数据与隐私

- 仓库公开：个人数据功能（记忆、邮件、日历）是否进私有 fork，待决策
- 密钥走 Setting / 环境变量，不进仓库（31 §5 同）
- 音频、邮件正文默认不落盘（用户记忆 / 知识库显式授权除外）

## 8. 迭代路线

- Phase 0（文档）：31 + 本方案（当前）
- Phase 1（MVP）：PWA 壳 + 生活类工具前 3 个 + 语音 Phase 1（半双工）
- Phase 2：React Native + 语音 Phase 2（全双工打断）+ 剩余工具
- Phase 3：电话网关；应用商店

## 9. 待决策

- [ ] 私有 fork（个人数据）
- [ ] 移动端：PWA 起步是否接受 iOS 限制
- [ ] 生活类工具优先级排序
- [ ] STT/TTS 厂商（见 31 §7）
