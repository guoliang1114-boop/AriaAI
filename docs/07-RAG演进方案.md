# AriaAI RAG 演进方案

> 更新日期：2026-04-12
> 说明：结合最新 `context_builder.py` 与 `rag.py` 状态重写

---

## 1. 当前结论

RAG 仍然是可运行的 baseline，但已经从“纯 prompt 注入工具”迈向“带结构化引用结果的上下文服务”。

本轮关键变化：

- `retrieve_structured()` 已返回结构化结果
- `RetrievalResult` / `RetrievalContext` 已支持来源信息
- `context_builder.py` 已把 RAG 纳入统一聊天上下文组装

这意味着 RAG 不再只是检索文本片段，而开始服务前端引用展示和更清晰的上下文注入。

---

## 2. 当前实现

当前链路：

```text
上传文档
-> 解析文本
-> 切块
-> embedding
-> 存入 DocumentChunk
-> retrieve_structured(query)
-> 生成 text + results
-> context_builder 注入聊天上下文
-> chat.py 将 references 推给前端
```

关键文件：

- `AriaAI/backend/app/services/rag.py`
- `AriaAI/backend/app/services/context_builder.py`
- `AriaAI/backend/app/routers/knowledge.py`
- `AriaAI/backend/app/routers/chat.py`

---

## 3. 当前优点

- 已支持结构化引用结果
- 已与聊天上下文组装统一
- 已经具备向前端展示 citation 的基础

---

## 4. 当前限制

- embedding 仍存为 JSON
- 检索仍偏简单 top-k
- metadata filter 能力有限
- rerank 尚未引入

---

## 5. 后续演进建议

### Phase 1

- 继续强化前端引用展示
- 明确项目 / 客户 / 全局知识的优先级

### Phase 2

- metadata filter
- rerank
- query rewrite

### Phase 3

- 向量索引 / 专门向量库
- 多知识空间
- 检索评估体系

---

## 6. 与产品主线的关系

RAG 的核心价值不是“能搜”，而是：

- 让项目内对话更懂上下文
- 让导出与生成物更有依据
- 让客户和项目知识能复用

所以 RAG 演进仍应优先服务项目工作流闭环，而不是孤立追求更复杂的检索技术。
