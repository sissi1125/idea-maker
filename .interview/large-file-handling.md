# 面试题 — 大文件处理与前端安全渲染

相关文件：
- `app/components/playground/OutputTracePanel.tsx`（`truncateStrings` / `TruncatedString`）
- `app/lib/docStore.ts`（base64 二进制存储）
- `app/app/api/documents/route.ts`（列表接口不返回 rawContent）

---

## Q1：用户上传了一份 200 页的 PDF，前端展示 preprocess 输出时页面卡死，你怎么排查和解决？

**答：**

**排查步骤：**
1. 打开 DevTools → Performance 录制，确认是否出现长任务（Long Task > 50ms）
2. 查看 Elements 面板，找到 Output 区域的 DOM 节点数量
3. 确认 `JSON.stringify(output, null, 2)` 对一个含 20 万字符字符串的对象会产生多大的文本节点

**根因：**
- `rawText` + `cleanText` 是文档全文，可能 10~100 万字符
- 把它们直接 `JSON.stringify` 放进 `<pre>` 标签，浏览器需要一次性创建巨大文本节点并做布局计算，主线程被阻塞

**解决方案（本项目实现）：**
- `truncateStrings()` 递归遍历 output 对象，把超过 500 字符的字符串字段替换为 `{ __truncated: true, preview, full, totalChars }`
- `TruncatedString` 组件默认只渲染 preview，点击"展开"才把 `full` 写入 DOM
- 这样无论文件多大，初始渲染的字符数都是 O(字段数 × 500)，恒定可控

---

## Q2：为什么用 500 字符作为截断阈值？怎么决定这个数字的？

**答：**

500 字符是一个经验值，权衡了：
- **可读性**：500 字符约等于 3~5 行正常段落，足以让用户判断解析结果是否正确
- **性能**：一个字段 500 字符，10 个字段就是 5000 字符，远低于会引起布局卡顿的阈值（一般 > 10 万字符才明显）
- **可扩展性**：`STRING_TRUNCATE` 是常量，调整一处即全局生效

生产环境可以根据实际 benchmark 调整，比如改成 1000 或 2000 都合理，关键是不要把这个值设为"无限"。

---

## Q3：除了截断展示，还有哪些方案可以处理大文本输出？各自适用场景是什么？

**答：**

| 方案 | 原理 | 适用场景 | 缺点 |
|------|------|---------|------|
| **截断 + 展开**（本项目） | 初始渲染截断，按需展开 | Playground 调试界面，用户通常只看前几行判断正确性 | 展开后仍可能卡顿 |
| **虚拟滚动**（react-window / tanstack virtual） | 只渲染视口内的行 | 需要滚动浏览完整内容，如日志查看器 | 实现复杂，需要固定行高 |
| **分页展示** | 每页 N 行，用户翻页 | 表格类数据 | 用户体验割裂 |
| **流式渲染**（ReadableStream） | 边生成边渲染 | LLM 流式输出 | 不适用于一次性 JSON 输出 |
| **Web Worker 处理** | 在 Worker 里做 JSON.stringify，不阻塞主线程 | 超大 JSON（> 1MB） | 仍然需要把结果写入 DOM |

本项目选择"截断 + 展开"因为：
1. Playground 的核心用途是检查解析结果对不对，不是阅读全文
2. 实现简单，无额外依赖
3. 用户真正需要全文时，可以直接从文档库下载原文

---

## Q4：你的 API 列表接口（GET /api/documents）不返回 rawContent，为什么这样设计？

**答：**

`rawContent` 可能是 base64 编码的 PDF binary（一个 5MB PDF → base64 后约 6.7MB 的字符串），或者是几万字的文档全文。如果列表接口每次返回所有文档的完整内容：

1. **网络**：每次进入页面需要传输几十 MB 数据
2. **内存**：前端把所有文档全文存在 React state 里，占用大量内存
3. **安全**：用户只需要选择文档，不需要在列表阶段看到全文

正确设计：
- **列表接口**：只返回 metadata（id、fileName、fileSize、hash、version、createdAt 等）
- **详情接口**（如 `GET /api/documents/:id`）：按需返回完整内容，只在实际需要时调用（如 preprocess、idempotency 等 pipeline stage 直接从服务端 docStore 读取，不经过前端）

这和数据库设计原则一致：SELECT 列表不要 SELECT *，尤其是大字段。

---

## Q5：PDF 文件在你的系统里如何存储？为什么不直接存原始 binary？

**答：**

存储为 base64 字符串，原因是：
- 系统当前用 JSON 文件（`data/documents.json`）做本地持久化
- JSON 不能直接包含 binary 数据，必须编码为文本
- base64 是 binary → text 的标准编码，解码无损

实现细节（`docStore.ts`）：
```typescript
// 上传时：arrayBuffer → base64
const arrayBuffer = await file.arrayBuffer();
rawContent = Buffer.from(arrayBuffer).toString("base64");
isBinary = true;

// 使用时：base64 → Buffer 传给 pdf-parse / mammoth
export function getDocumentBuffer(doc: DocumentRecord): Buffer {
  if (doc.isBinary) return Buffer.from(doc.rawContent, "base64");
  return Buffer.from(doc.rawContent, "utf-8");
}
```

迁移到 PostgreSQL 时：二进制文件用 `BYTEA` 类型存储，不需要 base64，`getDocumentBuffer` 只需修改内部实现，上层调用不变（Repository Pattern）。
