# AriaAI RAG 演进方案

> 更新日期：2026-05-15
> 说明：RAG 现状诊断 + 演进路径。

---

## 1. 当前实现

```text
上传文档 → 解析文本 → 切块 → embedding → DocumentChunk
→ retrieve_structured(query) → 结构化引用
→ context_builder 注入聊天上下文 → 前端展示 citation
```

关键文件：`rag.py`、`context_builder.py`、`knowledge.py`、`chat_streaming.py`

## 2. 当前状态

| 维度 | 状态 |
|------|------|
| 文档上传/解析/切块 | ✅ 可用 |
| embedding 存储 | JSON 字段（非 pgvector） |
| 检索方式 | 全量 chunk 加载到内存做余弦相似度 |
| 结构化引用 | ✅ 已支持 |
| 聊天上下文整合 | ✅ context_builder 统一注入 |
| metadata filter | 有限 |
| rerank | 未引入 |
| 检索评估体系 | 无 |

## 3. 已知风险

**全量 chunk 加载到内存做余弦相似度** — 知识库增长后会 OOM。当前规模（几十个文档）可撑，但不是长期方案。

## 4. 演进路径

### Phase 1：做稳（已完成）

- ✅ 知识库状态流转
- ✅ 项目/客户/全局知识优先级
- ✅ 前端引用展示

### Phase 2：提升质量（未启动）

- 引入 metadata filter（按项目/客户/文档类型过滤）
- 引入 rerank（cross-encoder 重排）
- 引入 query rewrite（查询改写）

### Phase 3：提升规模（未启动）

- 引入 pgvector 替代内存计算
- 建立检索评估与对比机制

## 5. 当前判断

> docs 11：当前知识库规模小，Python 内存计算还能撑，且这不是北极星场景的瓶颈。**本月不做 pgvector。**

RAG 演进应优先服务项目工作流，不脱离主产品单独追求复杂检索技术。
