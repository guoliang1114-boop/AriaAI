# Documentation index

Updated 2026-09-20. Start with [README](../README.md) for setup, [CONTRIBUTING](../CONTRIBUTING.md) for checks, and [agent.md](../agent.md) for repository boundaries. Product and runtime state belong to Aria's native services.

Status labels describe the document, not a released version: **Contract** documents implemented behavior with historical sections; **Plan** describes direction and may include completed phases; **Historical** records an earlier iteration; **Current work** covers changes still awaiting release. Use [the acceptance record](23-2026-09-19全量推进验收.md) and [the latest memory boundary acceptance](26-模型完成状态与记忆生成加固验收.md) for actual validation and deployment evidence.

| Document | Purpose | Status / tracking |
| --- | --- | --- |
| [00 Project overview](00-项目总览.md) | Product domains, stack, and overall architecture | Contract; read code for exact current module paths |
| [01 Product strategy](01-产品战略方向.md) | Target users and strategic direction | Plan |
| [02 Skill system](02-Skill体系.md) | Skill package, publication, and runtime concepts | Contract; [#72](https://github.com/guoliang1114-boop/AriaAI/issues/72) |
| [03 Skill standardization](03-Skill标准化规范.md) | Package structure and declaration rules | Contract |
| [04 RAG evolution](04-RAG演进方案.md) | Retrieval evolution and prior tradeoffs | Plan; current work is in 24 |
| [05 Conversation design](05-对话系统设计与规范.md) | Chat, sources, events, approvals, and delivery contracts | Contract; later dated sections supersede earlier stages |
| [06 HITAS](06-Human-in-the-Loop%20Tool%20Approval%20设计.md) | Review, authorization, and execution envelopes | Contract |
| [07 Architecture diagrams](07-AriaAI架构与对话逻辑图.md) | System, chat, and memory diagrams | Architecture reference |
| [08 Skill assessment](08-Skill体系评估与优化路线图.md) | Skill gaps and quality roadmap | Plan; scores are dated evidence |
| [09 Skill authoring](09-Skill编写规范.md) | How to write inputs, outputs, examples, and QA | Contract; [#72](https://github.com/guoliang1114-boop/AriaAI/issues/72) |
| [10 Review follow-ups](10-代码Review遗留事项.md) | Reconciled historical bugs and current boundaries | Current review; stale shared-access claims removed |
| [11 Model and Harness](11-Model-Harness产品方案设计.md) | Model/runtime responsibility and execution design | Plan and implemented phases; [#70](https://github.com/guoliang1114-boop/AriaAI/issues/70) |
| [12 Memory](12-记忆系统优化方案.md) | User/project/client memory authority and evolution | Contract and plan; [#74](https://github.com/guoliang1114-boop/AriaAI/issues/74) |
| [13 V0.0.4](13-V0.0.4迭代计划.md) | Earlier iteration scope and progress | Historical |
| [14 Knowledge base](14-V0.0.5知识库开发方案.md) | Source-scoped ingestion, permissions, and citations | Contract and plan; [#69](https://github.com/guoliang1114-boop/AriaAI/issues/69) |
| [15 Skill upgrades](15-Skill能力质变升级清单.md) | Planned capability upgrades | Plan |
| [16 Skill deliverables](16-Skill交付物总表.md) | Expected outputs across packages | Reference; each package is authoritative |
| [17 Workspace gaps](17-Agentic%20Workspace产品Gap分析.md) | Product capability gap analysis | Historical assessment |
| [18 Workspace design](18-Agentic%20Workspace升级功能设计说明书.md) | Agentic workflow design | Plan and implemented phases; [#70](https://github.com/guoliang1114-boop/AriaAI/issues/70) |
| [20 OSS roadmap](20-OSS-Roadmap.md) | Public milestones and contribution areas | Plan; issue status is independent of local completion |
| [21 Native Harness and upstream reuse](21-Codex-Harness集成与源码复用方案.md) | Small upstream ports and Aria-owned runtime boundaries | Contract; no production Codex connection |
| [22 Project chat and Skills](22-项目对话与Skill交互全量优化方案.md) | Cross-domain quality and interaction work | Plan and implemented phases |
| [23 Acceptance record](23-2026-09-19全量推进验收.md) | Local checks, deployed baseline, issue mapping, remaining work | Current work; [#77](https://github.com/guoliang1114-boop/AriaAI/issues/77) |
| [24 Semantic retrieval](24-知识语义检索与质量验收.md) | Model identity, setup, reindex, fallback, and evaluation | Current work; [#69](https://github.com/guoliang1114-boop/AriaAI/issues/69) |
| [25 Preview notes](25-Agentic-Workspace-Preview-发布说明.md) | Change notes, latency contract, release checks, limitations | Current work; [#73](https://github.com/guoliang1114-boop/AriaAI/issues/73) |
| [26 Model output and memory generation](26-模型完成状态与记忆生成加固验收.md) | Final-output validation, source instruction isolation, and regression evidence | Released `03aa470`; further security work in [#74](https://github.com/guoliang1114-boop/AriaAI/issues/74) |

Deployment is governed by [DEPLOY.md](../DEPLOY.md). The backend [Product Run Event contract](../backend/app/services/chat/product_run_events.py) and its [frontend mirror](../web/src/types/productRunEvent.ts) are the source of truth for public run events. [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md) records upstream attribution.

The login screenshot in the README contains no customer data. New UI screenshots should use synthetic or empty state. Static Skill grades and synthetic quality gates do not establish professional correctness or production latency.
