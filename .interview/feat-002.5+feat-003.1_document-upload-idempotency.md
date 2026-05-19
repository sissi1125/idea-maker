# 面试题 — Document Upload & Idempotency（feat-002.5 + feat-003.1）

相关文件：
- `app/lib/docStore.ts`
- `app/app/api/documents/route.ts`
- `app/app/api/pipeline/idempotency/route.ts`
- `app/components/playground/DocumentUploadPanel.tsx`

---

## Q1：你的系统是如何判断同一份文档是否已经入库的？为什么不直接用文件名？

**答：**
用 SHA-256 对文档内容计算哈希摘要，而非文件名。原因是文件名不稳定——同一份产品说明书可能被命名为 `v1.md`、`final.md`、`产品介绍.pdf`，内容完全相同；反之，同名文件内容可能已经更新。内容哈希才是真正的"指纹"。

本项目支持三种变体：
- `sha256-content`：对原始内容计算，最通用
- `normalized-sha256`：忽略空白差异，适合用户轻微编辑后重传的场景
- `file-signature`：文件名 + 大小 + 内容哈希的复合签名，适合同内容不同文件的场景

---

## Q2：你在本地用 JSON 文件存储文档，后续如何迁移到 PostgreSQL？需要改哪些地方？

**答：**
所有读写都封装在 `lib/docStore.ts` 里，API 路由和组件只调用 `listDocuments()`、`createDocument()` 等函数，不直接操作文件系统。迁移时只需重写 `docStore.ts` 的内部实现——将 `fs.readFileSync` 换成 `pg` 查询，函数签名和返回类型保持不变，上层代码零修改。

这是**仓库模式（Repository Pattern）**的实践：将数据访问细节与业务逻辑分离。

---

## Q3：用户上传同内容文档时，系统应该怎么处理？你的 versionPolicy 是如何设计的？

**答：**
系统不强制拒绝，而是把决策权交给用户，通过 `versionPolicy` 参数控制：

- `skip-existing`：直接返回已有记录，不再 ingestion，适合幂等批量导入
- `new-version`：保留历史、新增版本，适合文档持续迭代的场景（可追溯旧版本检索效果）
- `replace-existing`：覆盖旧版本，适合临时测试文档

这样设计的原因是：在 RAG 场景中，"旧版本的 chunk 还在 vector store 里"是一个常见脏数据来源，必须显式处理而不是静默忽略。

---

## Q4：文档哈希检查是 O(n) 遍历，生产环境如何优化？

**答：**
当前 dev 实现是在内存里对所有文档重新计算哈希后比较，文档量小时没问题。生产优化方向：

1. 在数据库的 `documents` 表里增加 `content_hash` 列并建索引（`CREATE INDEX ON documents(content_hash)`），查重变成一次 `WHERE content_hash = $1` 的索引查找，O(1)
2. 上传时同步计算并写入哈希，不在查重时重新计算

本项目的 `docStore.ts` 已经在创建时计算并存储了 `hash` 字段，迁移到 PostgreSQL 时直接对应到数据库列。

---

## Q5：前端文档库在页面刷新后是如何保持状态的？为什么不用 localStorage？

**答：**
页面挂载时调用 `GET /api/documents`，从服务端读取持久化的文档列表，而不是依赖 `localStorage`。

优点：
1. **多标签页一致**：任何标签页上传的文档，刷新其他标签页都能看到
2. **无容量限制**：`localStorage` 只有约 5MB，PDF 很容易超限；服务端文件系统/数据库没有这个限制
3. **可扩展**：后续接入数据库或多用户时，只需修改 API，前端逻辑不变

代价是需要一次网络请求——对内部工具类 Playground 完全可接受。
