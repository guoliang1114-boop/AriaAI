# AriaAI RAG 演进方案

> 更新日期：2026-04-12
> 说明：结合最新 `context_builder.py` 重新描述 RAG 在系统中的位置

---

## 1. 当前结论

RAG 仍然是可运行的 baseline，但它在架构中的位置已经更清晰了。

本轮更新后：

- RAG 不再只是散落在 `chat.py` 里的逻辑片段
- 它开始通过 `context_builder.py` 参与统一的聊天上下文组装

这是一种重要但仍未完成的架构改进。

---

## 2. 当前实现

路径大致是：

```text
上传文档
-> 解析文本
-> 切块
-> embedding
-> 存入 DocumentChunk
-> 查询 top-k
-> 通过 context_builder 注入聊天上下文
```

关键文件：

- `AriaAI/backend/app/routers/knowledge.py`
- `AriaAI/backend/app/services/parser.py`
- `AriaAI/backend/app/services/rag.py`
- `AriaAI/backend/app/services/context_builder.py`

---

## 3. 当前优点

- 已经能够为聊天提供真实文档上下文
- 与项目/技能上下文组装方向开始统一
- 结构比之前更清晰

---

## 4. 当前限制

- embedding 仍存为 JSON
- 检索仍偏简单 top-k
- 元数据过滤能力有限
- 前端对引用来源的解释性仍不够强

---

## 5. 后续演进建议

### Phase 1

- 让 `context_builder` 持续成为统一注入入口
- 把引用来源在前端展示得更清楚

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

RAG 的意义不在“能搜”，而在：

- 让项目内对话更懂上下文
- 让生成物更有依据
- 让客户和项目知识能复用

所以 RAG 的演进优先级，应始终服从项目工作流闭环。
