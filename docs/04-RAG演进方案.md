# AriaAI RAG 演进方案

> 更新日期：2026-05-24
> 关联文档：[00-项目总览](./00-项目总览.md)、[05-对话系统设计与规范](./05-对话系统设计与规范.md)

## 1. 当前定位

RAG 是 AriaAI 的基础上下文能力，用于把项目、客户或全局知识库文档注入对话。它不是当前产品护城河的核心，但必须稳定、可解释、可展示引用。

当前优先级：

1. 保证项目/客户范围检索稳定。
2. 给对话和前端提供来源引用。
3. 避免过早引入复杂向量基础设施。
4. 在文档规模增长后再迁移到 pgvector 或专用向量库。

## 2. 当前实现

关键文件：

| 文件 | 说明 |
|---|---|
| `backend/app/routers/knowledge.py` | 文档上传、列表、删除、查询、统计 |
| `backend/app/services/parser.py` | 文件文本解析 |
| `backend/app/services/rag.py` | 切块、embedding、检索 |
| `backend/app/models/db.py` | `KnowledgeDocument`、`DocumentChunk` |
| `backend/app/services/context_builder/rag_context.py` | 对话上下文中的 RAG 注入 |

处理链路：

```text
上传文档
  ↓
保存到 UPLOADS_DIR/knowledge
  ↓
创建 KnowledgeDocument(vector_status=pending)
  ↓
后台任务解析文本
  ↓
chunk_text()
  ↓
fastembed 生成 embedding
  ↓
DocumentChunk.embedding_json 保存 JSON 向量
  ↓
retrieve_structured()
  ↓
返回 chunk、document_name、document_id、chunk_index、score
  ↓
context_builder 注入对话，前端展示引用
```

## 3. 数据模型

### 3.1 KnowledgeDocument

| 字段 | 说明 |
|---|---|
| `id` | 文档 ID |
| `name` | 原始文件名 |
| `file_type` | 文件类型 |
| `path` | 相对 `UPLOADS_DIR` 的路径 |
| `category` | 用户或系统分类 |
| `vector_status` | `pending / processing / synced / failed` |
| `vector_progress` | 向量化进度 |
| `chunk_count` | chunk 数 |
| `client_id` | 可选客户范围 |
| `project_id` | 可选项目范围 |

### 3.2 DocumentChunk

| 字段 | 说明 |
|---|---|
| `document_id` | 所属文档 |
| `chunk_index` | chunk 序号 |
| `content` | chunk 文本 |
| `embedding_json` | JSON 编码的 float list |

## 4. API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/knowledge/documents` | 列出文档，可按 `project_id` 或 `client_id` 过滤 |
| `POST` | `/knowledge/documents` | 上传文档并后台索引 |
| `DELETE` | `/knowledge/documents/{doc_id}` | 删除文档和 chunk |
| `GET` | `/knowledge/stats` | 文档数和向量数 |
| `POST` | `/knowledge/query` | 查询知识库，当前返回 legacy text context |

## 5. 当前检索策略

`retrieve_structured()` 支持四种范围：

1. 指定 `doc_ids`：只查这些文档。
2. 指定 `project_id`：只查项目知识文档。
3. 指定 `client_id`：只查客户知识文档。
4. 不指定范围：查全部 chunk。

排序方式：

```text
query embedding
  ↓
加载候选 DocumentChunk
  ↓
逐个计算 cosine_similarity
  ↓
按 score 倒序
  ↓
取 TOP_K_RESULTS
```

当前优点：

- 实现简单。
- 易于调试。
- 无需额外数据库扩展。
- 可返回结构化引用。

当前缺点：

- 向量保存在 JSON 字段中，无法使用数据库向量索引。
- 检索时加载所有候选 chunk 到内存，规模增长后会慢且可能 OOM。
- 缺少 rerank。
- metadata filter 仍较基础。
- 没有系统化检索评估集。

## 6. 与对话系统的关系

RAG 不直接决定答案。它只是 context builder 的一个上下文层。

当前对话已将两类可核验证据分开建模：

- `[K*]` 表示知识库/RAG 文档片段，由 `KnowledgeEvidenceManifest v1` 校验。
- `[M*]` 表示当轮按问题召回的项目记忆，由 `Project Memory Evidence Manifest v1` 校验。

两类正文都只进入当次 Provider 上下文；持久化消息、Trace 和交付物只保存来源元数据、内容摘要和实际被回指的合法引用。这使得文档证据与记忆证据可以在同一答案中同时展示，但不会混淆来源语义。

对话装配顺序应遵循：

1. 身份和模式 prompt。
2. 项目/客户结构化上下文。
3. 记忆摘要和干系人。
4. RAG 检索片段和引用。
5. Skill prompt。
6. 对话历史。

项目分析类请求默认优先使用已注入的结构化上下文。只有用户明确要求读取或引用具体文件时，才进入 `EXPLICIT_FILE_READ` 并暴露读工具。

## 7. 风险判断

### 7.1 当前最大技术风险

全量候选 chunk 内存检索会随知识库增长线性变慢。

风险触发条件：

- 单实例 chunk 数达到数万级。
- 同一项目或客户下有大量长文档。
- 并发查询明显增加。
- embedding JSON 解析成为热点。

### 7.2 当前不是最大产品瓶颈

AriaAI 的北极星场景依赖客户关系上下文，而不是海量知识库检索。当前更重要的是：

- 会前简报质量。
- 干系人捕获。
- 项目/客户记忆自动沉淀。
- Skill 结果资产化。

因此，本阶段不建议先做复杂向量平台重构。

## 8. 演进路线

### Phase 1：做稳，当前基本完成

能力：

- 文档上传和后台索引。
- 文本解析、切块、embedding。
- 项目/客户范围过滤。
- 结构化引用结果。
- 对话上下文注入。

需要补齐：

- 索引失败原因可见。
- 后台任务失败重试。
- 大文件解析超时处理。
- `/knowledge/query` 返回结构化 citation，而不只是 legacy text。

### Phase 2：提升质量

目标：让检索结果更准、更可控。

建议任务：

- 增强 metadata filter：项目、客户、文档类型、分类、上传时间、文件来源。
- 增加 query rewrite：把用户问题改写成检索友好的查询。
- 增加 rerank：对 top N chunk 做二次排序。
- 增加引用去重：避免同一文档连续 chunk 占满上下文。
- 增加检索评估集：记录 query、期望文档、期望片段、当前召回。

### Phase 3：提升规模

目标：支持更大的知识库和更高并发。

建议任务：

- 引入 pgvector 或专用向量库。
- 将 `embedding_json` 迁移为向量列或独立向量表。
- 建立向量索引。
- 支持增量重建和按文档重建。
- 为检索接口增加分页和超时保护。

### Phase 4：服务客户关系智能

目标：RAG 不只是找片段，而是帮助沉淀关系判断。

建议任务：

- 从会议纪要和项目笔记中识别干系人信息。
- 从历史文档中抽取客户敏感点和决策模式。
- 把文档证据关联到客户记忆条目。
- 在会前简报中展示“此建议来自哪些文件/对话/项目”。

## 9. 当前建议

短期不做 pgvector，除非出现明确规模压力。优先做：

1. `/knowledge/query` 返回结构化引用。
2. 索引失败原因和重试。
3. 项目/客户/文档类型 metadata filter。
4. 简单检索评估集。
5. 会前简报中的来源引用。

RAG 的技术演进应服务产品主线，不应脱离客户关系智能单独追求复杂检索架构。
