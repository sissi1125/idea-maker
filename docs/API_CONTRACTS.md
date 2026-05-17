# API 契约

所有 endpoints 应返回统一 envelope：

```json
{
  "ok": true,
  "data": {},
  "trace": {
    "requestId": "",
    "step": "",
    "durationMs": 0,
    "warnings": []
  },
  "error": null
}
```

错误 envelope：

```json
{
  "ok": false,
  "data": null,
  "trace": {
    "requestId": "",
    "step": "",
    "durationMs": 0,
    "warnings": []
  },
  "error": {
    "code": "",
    "message": "",
    "details": {}
  }
}
```

## Document Endpoints

### POST /api/documents/upload

用途：上传或创建产品文档，并保存原始内容、metadata、hash 和版本信息。支持 `multipart/form-data` 文件上传，也支持 JSON 文本导入。

JSON Request：

```json
{
  "fileName": "product.md",
  "mimeType": "text/markdown",
  "content": "# Product",
  "sourceType": "markdown",
  "idempotencyPolicy": "new-version"
}
```

Response data：

```json
{
  "documentId": "doc_001",
  "documentVersionId": "docver_001",
  "fileName": "product.md",
  "fileSize": 128,
  "mimeType": "text/markdown",
  "hash": "sha256...",
  "version": 1,
  "duplicated": false,
  "recommendedAction": "process",
  "createdAt": "2026-05-18T00:00:00.000Z"
}
```

### GET /api/documents

用途：Playground 首次进入或刷新时加载已上传文档列表。

Response data：

```json
{
  "documents": [
    {
      "documentId": "doc_001",
      "latestVersionId": "docver_001",
      "fileName": "product.md",
      "latestVersion": 1,
      "fileSize": 128,
      "mimeType": "text/markdown",
      "hash": "sha256...",
      "processingStatus": "uploaded",
      "createdAt": "2026-05-18T00:00:00.000Z",
      "lastSelectedAt": null
    }
  ]
}
```

### GET /api/documents/:documentId

用途：加载某个文档的 metadata、版本列表和最近 pipeline runs。

Response data：

```json
{
  "document": {
    "documentId": "doc_001",
    "fileName": "product.md",
    "versions": [
      {
        "documentVersionId": "docver_001",
        "version": 1,
        "hash": "sha256...",
        "fileSize": 128,
        "mimeType": "text/markdown",
        "processingStatus": "uploaded",
        "createdAt": "2026-05-18T00:00:00.000Z"
      }
    ]
  }
}
```

### POST /api/documents/:documentId/select

用途：记录用户当前选择的 document version，作为后续 pipeline input。

Request：

```json
{
  "documentVersionId": "docver_001"
}
```

Response data：

```json
{
  "selectedDocumentId": "doc_001",
  "selectedDocumentVersionId": "docver_001",
  "inputRef": "document-version:docver_001"
}
```

## RAG Endpoints

### POST /api/rag/idempotency/check

Request：

```json
{
  "documentId": "doc_001",
  "documentVersionId": "docver_001",
  "fileName": "product.md",
  "inputRef": "document-version:docver_001",
  "mode": "skip-existing"
}
```

Response data：

```json
{
  "documentVersionId": "docver_001",
  "fileName": "product.md",
  "fileSize": 128,
  "hash": "sha256...",
  "exists": false,
  "documentId": "doc_001",
  "version": 1,
  "recommendedAction": "process"
}
```

### POST /api/rag/preprocess

Request：

```json
{
  "documentId": "doc_001",
  "documentVersionId": "docver_001",
  "fileName": "product.md",
  "inputRef": "document-version:docver_001",
  "method": "markdown-structure"
}
```

Response data：

```json
{
  "documentId": "doc_001",
  "rawText": "# Product",
  "cleanText": "Product",
  "metadata": {
    "sourceType": "markdown"
  }
}
```

### POST /api/rag/chunk

Request：

```json
{
  "documentId": "doc_001",
  "text": "Product text",
  "method": "fixed-size",
  "params": {
    "chunkSize": 800,
    "overlap": 120,
    "separator": "\n\n"
  }
}
```

Response data：

```json
{
  "documentId": "doc_001",
  "chunkCount": 1,
  "tokenEstimate": 24,
  "chunks": [
    {
      "id": "chunk_001",
      "text": "Product text",
      "metadata": {
        "index": 0,
        "sourceRef": "product.md#chunk-001"
      }
    }
  ]
}
```

### POST /api/rag/transform

Request：

```json
{
  "chunks": [],
  "method": "summary-keywords",
  "params": {
    "keywordCount": 5
  }
}
```

Response data：

```json
{
  "chunks": [
    {
      "id": "chunk_001",
      "originalText": "",
      "enhancedText": "",
      "metadata": {
        "keywords": []
      }
    }
  ]
}
```

### POST /api/rag/embed

Request：

```json
{
  "chunks": [],
  "method": "debug-deterministic",
  "provider": "debug-deterministic",
  "model": "debug-embedding-v1",
  "dimension": 16,
  "batchSize": 32
}
```

Response data：

```json
{
  "provider": "debug-deterministic",
  "model": "debug-embedding-v1",
  "modelSource": "local-debug",
  "dimension": 16,
  "costEstimate": 0,
  "latencyMs": 12,
  "embeddings": [
    {
      "chunkId": "chunk_001",
      "vectorPreview": []
    }
  ]
}
```

### POST /api/rag/store

Request：

```json
{
  "document": {},
  "chunks": [],
  "embeddings": [],
  "method": "pgvector-upsert-version",
  "storage": "postgres-pgvector"
}
```

Response data：

```json
{
  "storage": "postgres-pgvector",
  "documentId": "doc_001",
  "storedChunkCount": 1,
  "storedEmbeddingCount": 1,
  "embeddingIndex": {
    "provider": "debug-deterministic",
    "model": "debug-embedding-v1",
    "dimension": 16
  }
}
```

### POST /api/rag/query-rewrite

Request：

```json
{
  "query": "Who is this product for?",
  "method": "rule-keyword-expansion",
  "params": {
    "maxQueries": 3,
    "rewriteGoal": "selling-points",
    "targetAudience": "indie developers"
  }
}
```

Response data：

```json
{
  "query": "Who is this product for?",
  "rewrittenQueries": [
    "Who is this product for?",
    "target users and product pain points",
    "indie developer use cases"
  ],
  "providerTrace": null
}
```

### POST /api/rag/retrieval

Request：

```json
{
  "queries": ["Who is this product for?"],
  "method": "hybrid-rrf",
  "topK": 5,
  "threshold": 0.72,
  "params": {
    "vectorWeight": 0.7,
    "textWeight": 0.3,
    "filters": {}
  }
}
```

Response data：

```json
{
  "queries": ["Who is this product for?"],
  "matches": [
    {
      "chunkId": "chunk_001",
      "score": 0.86,
      "text": "",
      "sourceRef": "product.md#chunk-001"
    }
  ]
}
```

### POST /api/rag/filter

Request：

```json
{
  "matches": [],
  "method": "score-threshold",
  "params": {
    "minScore": 0.72,
    "maxPerDocument": 8
  }
}
```

Response data：

```json
{
  "matches": [],
  "removedMatches": [],
  "filterReasons": []
}
```

### POST /api/rag/rerank

Request：

```json
{
  "query": "Who is this product for?",
  "matches": [],
  "method": "metadata-boost",
  "params": {
    "rerankTopN": 10,
    "criteria": "marketing relevance"
  }
}
```

Response data：

```json
{
  "matches": [],
  "beforeOrder": [],
  "afterOrder": [],
  "providerTrace": null
}
```

### POST /api/rag/citation

Request：

```json
{
  "matches": [],
  "method": "snippet-citation",
  "params": {
    "snippetLength": 240,
    "includePage": true,
    "maxEvidencePerClaim": 3
  }
}
```

Response data：

```json
{
  "evidencePack": [],
  "citations": [
    {
      "chunkId": "chunk_001",
      "sourceRef": "product.md#chunk-001"
    }
  ]
}
```

## Marketing Endpoints

### POST /api/marketing/profile

Request：

```json
{
  "evidenceChunkIds": ["chunk_001"],
  "retrievalRunId": "ret_001"
}
```

Response data：

```json
{
  "productProfile": {
    "productName": "",
    "targetUsers": [],
    "coreProblems": [],
    "coreFeatures": [],
    "positioning": "",
    "evidenceChunkIds": []
  }
}
```

### POST /api/marketing/selling-points

Request：

```json
{
  "productProfile": {},
  "evidenceChunkIds": ["chunk_001"]
}
```

Response data：

```json
{
  "sellingPointMap": {
    "functional": [],
    "emotional": [],
    "scenario": [],
    "differentiation": []
  },
  "evidence": []
}
```

### POST /api/marketing/ideas

Request：

```json
{
  "sellingPointMap": {},
  "platform": "x",
  "targetUser": "indie developer",
  "contentType": "tutorial",
  "marketingGoal": "activation"
}
```

Response data：

```json
{
  "ideas": [
    {
      "title": "",
      "angle": "",
      "sellingPointId": "",
      "targetUser": "",
      "platform": "",
      "hook": "",
      "outline": [],
      "evidenceChunkIds": []
    }
  ]
}
```
