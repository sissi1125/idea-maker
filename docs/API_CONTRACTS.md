# API 契约

## 约定

所有 pipeline endpoint 返回统一结构：

```json
{
  "output": { },       // stage 产物，字段因 stage 而异
  "trace":  { },       // 执行 trace：method、参数、耗时、统计信息
  "warnings": []       // 非致命警告，运行成功但有注意事项时填写
}
```

错误响应：

```json
{
  "error": {
    "code": "missing_document | document_not_found | internal_error | provider_not_available | ...",
    "message": "可读错误说明"
  }
}
```

> **注意**：当前阶段 API 路径前缀为 `/api/pipeline/*`（而非早期文档中的 `/api/rag/*`）。
> 路由设计决策：`pipeline` 比 `rag` 更准确——Retrieval 和 Generation 也在同一套 pipeline 框架下。

---

## 文档 Endpoints

### POST /api/documents

上传文档。支持 `multipart/form-data`（文件上传）和 `application/json`（粘贴文本）。

**二进制文件（PDF/DOCX）**：以 `arrayBuffer()` 读取后转 base64 存储（`isBinary: true`）。
**文本文件（MD/TXT）**：以 UTF-8 字符串存储（`isBinary: false`）。

multipart 请求字段：
- `file`: File（二进制或文本）
- 或 `text`: string + `fileName`: string（可选）

JSON 请求：
```json
{ "text": "...", "fileName": "product.md", "mimeType": "text/markdown" }
```

响应（201）— 不含 rawContent（可能很大）：
```json
{
  "document": {
    "id": "uuid",
    "fileName": "product.md",
    "fileSize": 1234,
    "mimeType": "text/markdown",
    "hash": "sha256hex",
    "version": 1,
    "isBinary": false,
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601",
    "processingStatus": "ready"
  }
}
```

### GET /api/documents

列出所有文档（按 createdAt 降序）。响应不含 rawContent。

```json
{ "documents": [ { /* 同上，无 rawContent */ } ] }
```

### DELETE /api/documents/:id

删除指定文档。

```json
{ "deleted": "uuid" }
```

### POST /api/documents/:id/select

验证文档存在，返回文档 metadata（供前端更新 pipelineRun 上下文）。

```json
{ "document": { /* 同 POST /api/documents 响应 */ } }
```

---

## Pipeline Endpoints

所有 pipeline endpoint 的 Request body：

```json
{
  "methodId": "method-name",
  "params":   { },
  "pipelineRun": {
    "selectedDocumentId": "uuid",
    "selectedDocumentVersionId": "uuid-v1"
  }
}
```

### POST /api/pipeline/idempotency

方法：`sha256-content` | `normalized-sha256` | `file-signature`

参数：
- `versionPolicy`: `skip-existing` | `new-version` | `replace-existing`
- `normalizeWhitespace`: boolean
- `includeFileName`: boolean

输出：
```json
{
  "output": {
    "fileName": "product.md",
    "fileSize": 1234,
    "mimeType": "text/markdown",
    "hash": "sha256hex",
    "exists": false,
    "documentId": "uuid",
    "version": 1,
    "recommendedAction": "proceed — 新文档，可继续 ingestion pipeline",
    "duplicateOf": { "id": "uuid", "fileName": "...", "version": 1 }
  },
  "trace": {
    "method": "sha256-content",
    "hashDescription": "...",
    "normalizeWhitespace": false,
    "includeFileName": false,
    "versionPolicy": "new-version",
    "durationMs": 12,
    "checkedAgainst": 3,
    "duplicatesFound": 0
  },
  "warnings": []
}
```

### POST /api/pipeline/preprocess

方法：`markdown-structure` | `plain-text` | `markitdown` | `pdf-pages` | `pymupdf`

| 方法 | 实现 | 说明 |
|------|------|------|
| `markdown-structure` | 纯 JS | heading path 栈 + MD 语法清洗 |
| `plain-text` | 纯 JS | 空白归一化 |
| `markitdown` | mammoth + turndown + pdf-parse v1 | 按 mimeType 自动路由 |
| `pdf-pages` | pdf-parse v1 | 按页提取，生成页码 sourceRef |
| `pymupdf` | Python 微服务（`services/pymupdf`） | 精确几何提取，需运行 docker compose |

输出：
```json
{
  "output": {
    "rawText": "...",
    "cleanText": "...",
    "charCount": 1000,
    "wordCount": 200,
    "metadata": {
      "fileName": "product.md",
      "mimeType": "text/markdown",
      "headings": ["产品介绍", "核心功能"],
      "pageCount": null
    },
    "sourceRefs": [
      { "type": "heading|paragraph|page", "value": "产品介绍 > 核心功能", "charStart": 0, "charEnd": 100 }
    ],
    "warnings": []
  },
  "trace": {
    "method": "markdown-structure",
    "isBinary": false,
    "rawCharCount": 1200,
    "cleanCharCount": 1000,
    "compressionRatio": "0.83",
    "headingCount": 2,
    "sourceRefCount": 5,
    "durationMs": 8
  }
}
```

pymupdf 环境变量：`PYMUPDF_SERVICE_URL`（默认 `http://localhost:8001`）

---

## 外部服务

### pymupdf 微服务

- **位置**：`services/pymupdf/`（Python FastAPI）
- **启动**：`docker compose up pymupdf`
- **端口**：宿主机 8001 → 容器 8000

`POST /extract`：
```json
{
  "pdf_base64": "base64string",
  "page_range": "1-10",
  "preserve_layout": true,
  "extract_images": false
}
```

`GET /health`：健康检查。

---

## 待实现 Endpoints

以下 endpoints 已在 `feature_list.json` 中规划，尚未实现：

- `POST /api/pipeline/chunk`（feat-003.3）
- `POST /api/pipeline/transform`（feat-003.4）
- `POST /api/pipeline/embedding`（feat-003.5）
- `POST /api/pipeline/storage`（feat-003.6）
- `POST /api/pipeline/query-rewrite`（feat-004.1）
- `POST /api/pipeline/retrieval`（feat-004.2）
- `POST /api/pipeline/filter`（feat-004.3）
- `POST /api/pipeline/rerank`（feat-004.4）
- `POST /api/pipeline/citation`（feat-004.5）
- `POST /api/pipeline/generation`（feat-005）
