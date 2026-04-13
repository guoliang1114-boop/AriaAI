# AriaAI RAG 演进方案

> 更新日期：2026-04-14
> 说明：结合当前 `rag.py`、`context_builder.py` 与知识库链路重写。

---

## 1. 当前结论

RAG 现在已经不是“把检索结果硬塞进 prompt”的原始形态，而是开始具备结构化引用和统一上下文装配能力；但它仍属于可用的 baseline，而不是成熟的知识检索系统。

当前已经具备：

- 文档上传、解析、切块、embedding
- `vector_status` 状态流转
- 结构化引用结果
- `context_builder.py` 统一注入聊天上下文

---

## 2. 当前实现链路

```text
上传文档
-> 解析文本
-> 切块
-> embedding
-> 存入 DocumentChunk
-> retrieve_structured(query)
-> 返回 text + structured results
-> context_builder 注入聊天上下文
-> 聊天链路把 references 回给前端
```

关键文件：

- `AriaAI/backend/app/services/rag.py`
- `AriaAI/backend/app/services/context_builder.py`
- `AriaAI/backend/app/routers/knowledge.py`
- `AriaAI/backend/app/services/chat_streaming.py`

---

## 3. 当前优点

- 已支持结构化引用结果
- 已与聊天上下文构建链路整合
- 已具备面向前端展示 citation 的基础

---

## 4. 当前限制

- embedding 仍保存在 JSON 字段中
- 检索仍偏简单 top-k
- metadata filter 能力有限
- rerank 尚未引入
- 缺少更明确的检索评估体系

---

## 5. 演进建议

### Phase 1：把现有链路做稳

- 补知识库状态流转与检索回归测试
- 明确项目 / 客户 / 全局知识的优先级
- 强化前端引用展示

### Phase 2：提升检索质量

- 引入 metadata filter
- 引入 rerank
- 引入 query rewrite

### Phase 3：提升规模与可维护性

- 引入更清晰的向量索引方案
- 评估独立向量库或更专业的检索层
- 建立检索评估与对比机制

---

## 6. 与产品主线的关系

RAG 的核心价值不是“能搜到”，而是：

- 让项目内对话更懂上下文
- 让生成与导出更有依据
- 让客户和项目知识能够复用

因此，RAG 演进应优先服务项目工作流，而不是脱离主产品单独追求复杂检索技术。
