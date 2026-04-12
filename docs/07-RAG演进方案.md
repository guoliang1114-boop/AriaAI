# AriaAI RAG 演进方案

> 更新日期：2026-04-12
> 说明：基于当前 `knowledge.py`、`parser.py`、`rag.py` 与模型定义整理

---

## 1. 当前结论

当前 RAG 已经不是空壳，而是一个可运行的 baseline：

```text
上传文档
-> 解析文本
-> 切块
-> 生成 embedding
-> 存储到 DocumentChunk
-> query top-k
-> 注入聊天上下文
```

它已经能支持第一阶段产品验证，但还没有达到稳定生产级检索系统的成熟度。

---

## 2. 当前实现

### 2.1 关键文件

- `AriaAI/backend/app/routers/knowledge.py`
- `AriaAI/backend/app/services/parser.py`
- `AriaAI/backend/app/services/rag.py`
- `AriaAI/backend/app/models/db.py`

### 2.2 当前配置

在 `app/config.py` 中：

- `CHUNK_SIZE = 800`
- `CHUNK_OVERLAP = 100`
- `TOP_K_RESULTS = 5`
- `EMBEDDING_MODEL = "all-MiniLM-L6-v2"`

### 2.3 当前数据模型

- `KnowledgeDocument`
- `DocumentChunk`

其中：

- `KnowledgeDocument.vector_status` 管理索引状态
- `DocumentChunk.embedding_json` 用 JSON 保存向量

---

## 3. 当前方案的优点

- 简单直接，易于调试
- 不依赖外部向量数据库
- 与当前 SQLite / PostgreSQL 模型兼容
- 适合小规模知识库验证

---

## 4. 当前方案的限制

### 4.1 embedding 存储方式偏重

- JSON 序列化体积大
- 不适合规模扩大

### 4.2 检索方式偏 baseline

- 主要是向量相似度 + top-k
- 缺少 rerank、metadata filter、query rewrite

### 4.3 可解释性有限

- 前端还没有完整展示 chunk 来源、分数和命中原因

### 4.4 项目/客户上下文还未深度融入 RAG

- 现在知识库是可用的
- 但“客户知识”“项目知识”“全局知识”的层级仍不够清晰

---

## 5. 建议演进路线

### Phase 1：稳定 baseline

- 清理乱码和状态文案
- 补充更多检索日志
- 明确 chunk metadata
- 让前端显示引用来源

### Phase 2：增强检索质量

- 增加 metadata filter
- 增加 query rewrite
- 增加 rerank
- 区分客户 / 项目 / 全局知识空间

### Phase 3：提升规模能力

- 把 embedding 存储从 JSON 迁出
- 引入向量索引或专门向量数据库
- 加入增量索引和后台任务

---

## 6. 与产品主线的关系

RAG 的真正价值不在“能搜文档”，而在于为项目工作流服务：

- 让项目内对话更懂上下文
- 让技能输出更少幻觉
- 让客户知识可复用
- 让生成物有来源依据

所以 RAG 演进应该优先服务：

- 项目
- 客户
- 生成物

而不是孤立地追求更复杂的检索技术。

---

## 7. 短期建议

接下来最值得先做的几件事：

1. 给 chunk 加更清晰的 metadata。
2. 在聊天结果中展示引用来源。
3. 明确项目知识与全局知识的检索优先级。
4. 为知识同步增加更稳定的状态流转。

---

## 8. 中长期方向

当产品进入更大规模团队使用后，再考虑：

- 向量索引服务
- 多知识空间权限
- 检索质量评估集
- 混合检索与 rerank

在那之前，最重要的是让当前这套 baseline 稳定、可解释、可维护。
