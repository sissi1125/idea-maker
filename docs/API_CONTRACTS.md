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

## Product Brief 事实层（feat-400.1，JwtAuthGuard）

字段级、可审核、可版本的产品事实档案。事实门禁从数据层开始：提取只写 `candidate`，只有用户 confirm/edit 才 `confirmed` 且写 revision 审计。

- `POST /projects/:projectId/product-brief/extract`（feat-400.1 slice 2）：从项目已 ingest 的 `rag_chunks` LLM 提取候选事实字段。只提取事实型分组；evidence 只保留真实存在的 chunk id（丢弃幻觉出处）；无 evidence 判 `inferred` 且置信度封顶 0.4。返回 `{ result: { extracted, chunkCount, truncated, fields[] } }`。无文档时 404。
- `GET /projects/:projectId/product-brief`：返回 `{ brief, fields, issues }`。`issues = { missingRequired[], unverifiedFacts[] }`。
- `POST /projects/:projectId/product-brief/fields`：新增/更新候选字段。body `{ group, key, value, source?, evidenceChunkIds?, confidence? }`。命中已确认字段时只标 `stale`，不覆盖值。
- `POST /projects/:projectId/product-brief/fields/:fieldId/confirm`：确认字段（version+1，写 revision）。
- `PATCH /projects/:projectId/product-brief/fields/:fieldId`：编辑字段值。body `{ value, reason? }`；事实型分组（identity/fact/audience/positioning）必填 `reason`。
- `POST /projects/:projectId/product-brief/fields/:fieldId/reject`：拒绝字段。body `{ reason? }`。
- `POST /projects/:projectId/product-brief/confirm`：在一个事务中把所有 `candidate/stale` 子字段逐条确认为 `confirmed`（每条写 revision），再确认整份 Brief v(N)。批量确认后仍缺关键字段则整体回滚并拒绝。

字段枚举：`group ∈ identity|fact|audience|positioning|style|visual|constraint`；`source ∈ document|website|user|historical_content|inferred`；`status ∈ candidate|confirmed|rejected|stale`。

## 受限官网导入（feat-400.1 slice 4，JwtAuthGuard）

只抓用户主动提交的官方域名，遵守 robots、同域白名单、路径白名单、限页/限深/限速；拒绝社交平台与私网地址（防 SSRF）。导入内容进 `source_content_chunks`，被 `/product-brief/extract` 作为 `source=website` 的候选事实 evidence。

- `POST /projects/:projectId/sources/import-website`：body `{ url, maxPages?(1-30,默认10), maxDepth?(0-3,默认2), replaceExisting? }`。同步抓取，返回 `{ result: { jobId, sourceRecordId, host, pagesFetched, pagesSkipped, pages[] } }`。`replaceExisting=true` 时，新官网成功导入后删除该项目的旧官网记录、页面与对应 `rag_chunks`；抓取失败时保留旧官网。社交平台/私网/非 http(s) → 400。
- `GET /projects/:projectId/sources`：返回 `{ records[], pages[] }`（来源记录 + 已抓页面）。

安全边界：不登录、不绕权限、不抓私有页、不做通用爬虫、不抓社交平台。私网地址默认拒绝，可用 env `ALLOW_PRIVATE_IMPORT_HOSTS=1` 放开（仅测试）。

## Claim Map（feat-400.2，JwtAuthGuard）

从已确认 Brief 字段派生的可审核传播单元。事实型（functional/outcome）无 evidence 不得批准；内容只能引用 approved Claim。

- `GET  /projects/:projectId/claims`：列出 Claim Map；返回项包含 `origin ∈ user|platform`。同状态下用户维护的 Claim 排在平台生成 Claim 之前。
- `POST /projects/:projectId/claims/derive`：从已确认 Brief 字段派生候选 Claim（按 source_field_id 去重）。
- `POST /projects/:projectId/claims`：手动新增。body `{ text, claimType, evidenceChunkIds?, riskLevel?, ... }`，写入 `origin=user`。`claimType ∈ functional|outcome|differentiation|emotional`。
- `POST /projects/:projectId/claims/:claimId/approve`：批准。事实型无 evidence → 400。
- `POST /projects/:projectId/claims/:claimId/block`：阻止。
- `PATCH /projects/:projectId/claims/:claimId`：用户编辑卖点文本与类型，body 为 `{ text, claimType }`；编辑后转为 `origin=user` 且状态回到 `candidate`，原 evidence chunk 关系不变。
- `DELETE /projects/:projectId/claims/:claimId`：删除用户不再需要的卖点；已关联视觉资产通过外键自动解除关联。

## 内容评测门禁（feat-400.2，JwtAuthGuard）

顺序：确定性规则门禁 → （门禁过才）评测 Agent → 决策器四态。**门禁失败直接 blocked，模型高分不能覆盖。**

- `POST /projects/:projectId/content/evaluate`：body `{ body, angle?, hook?, cta?, claimIds?, platform?, platformMaxLength?, platformBannedWords? }`。返回 `{ result: { variantId, gatePassed, gateFailures[], scores, decision, evaluationId } }`。`decision ∈ publish_candidate|human_review|revise|blocked`。门禁规则：unknown_claim / unapproved_claim / missing_evidence / unsupported_number（编造价格规格）/ banned_word / too_long / duplicate_claim。无评测（无 LLM key）→ human_review（不自动放行）。
- `GET  /projects/:projectId/content/queue`：human_review 队列。
- `POST /projects/:projectId/content/evaluations/:evalId/decision`：人工结论。body `{ decision: accepted|edited|rejected }`。
- `GET  /projects/:projectId/content/evaluations`：全部评测（可回放）。

---

## 反馈学习（feat-400.3，JwtAuthGuard）

从用户改稿里学偏好：系统只出「更新建议」，用户接受才落到产品档案的**表达约束**（group=style/constraint），**任何反馈都不会自动改产品事实**（数据库 CHECK + 代码断言双重保证）。

- `POST /projects/:projectId/feedback-learning/feedback`：记录一条内容反馈。body `{ action(adopted|edited|rejected), evaluationId?, originalText?, editedText?, category?, note? }`。未给 category 且 action=edited 时按 edit-diff 自动归类。返回 `{ id, category }`。
- `POST /projects/:projectId/feedback-learning/suggest`：聚合近期同类编辑反馈（达阈值 3）生成建议；已被任一既有建议消费过的反馈不重复触发。返回 `{ created[] }`。
- `GET /projects/:projectId/feedback-learning/suggestions`：列出建议（pending 在前）。
- `POST /projects/:projectId/feedback-learning/suggestions/:id/accept`：接受 → 写入 Brief 表达约束字段（confirmed）。返回 `{ accepted, fieldId, group, key }`。
- `POST /projects/:projectId/feedback-learning/suggestions/:id/reject`：忽略。

编辑归类 7 类：`tone_exaggerated | too_technical | too_verbose | missing_scenario | cta_unnatural | claim_inaccurate | platform_tone_off`。

---

## Campaign 内容包（feat-400.4，JwtAuthGuard）

一次传播任务（Campaign Brief）→ 3 个可比较角度。生成的角度只能引用**已批准 ∩ 本次允许**的卖点（grounding 剔除越界/幻觉引用）；读取时每个角度实时跑硬规则检查 + 决策，方便并排比较。**不做自动发布。**

- `POST /projects/:projectId/campaigns`：创建 Campaign Brief。body `{ goal(launch|feature_update|acquisition|messaging), targetAudience?, scenario?, platform?, maxLength?, cta?, allowedClaimIds?, avoidNotes? }`。
- `GET /projects/:projectId/campaigns`：列出。
- `DELETE /projects/:projectId/campaigns/:id`：删除内容任务及其候选内容；关联评估记录随候选外键级联删除。项目归属校验失败返回 404。
- `GET /projects/:projectId/campaigns/:id`：详情，返回 `{ campaign, variants[] }`，每个 variant 带 `{ gatePassed, gateFailures, decision }`。
- `POST /projects/:projectId/campaigns/:id/generate`：LLM 生成 3 个角度（替换已有 generated）。返回 `{ generated, droppedRefs }`。
- `POST /projects/:projectId/campaigns/:id/variants`：手写一个角度。body `{ body, angle?, hook?, cta?, claimIds? }`。
- `POST /projects/:projectId/campaigns/:id/variants/:vid/regenerate`：重新生成单个角度。

---

## 视觉资产 + 海报（feat-400.5，JwtAuthGuard）

海报只用**受限 SVG 模板 DSL（固定模板 + 文本槽，模型永不产 HTML/CSS）**渲染，且只能用**已批准的资产与 Claim**；出图前查模板/溢出/对比度/资产合法。用 sharp 把 SVG 光栅化成真实 PNG（替代 Playwright Chromium，见 feature_list feat-400.5 偏离说明）。

- `POST /projects/:projectId/assets`：multipart（字段 `file`；body `kind`, `label?`）。用户上传写入 `origin=user`，返回 `{ asset }`（含 sharp 解析的 width/height、sha256 hash，status=uploaded）。
- `GET /projects/:projectId/assets`：列表；返回项包含 `origin ∈ user|website|document|platform`，默认按用户上传、官网抓取、其他来源排序。
- `POST /projects/:projectId/assets/:id/approve`：批准（海报只能用已批准资产）。
- `GET /projects/:projectId/posters/templates`：可用模板（id + 尺寸 + 字数上限）。
- `POST /projects/:projectId/posters/render`：body `{ templateId, title, subtitle?, claimId?, logoAssetId?, bgColor?, fgColor? }`。先硬规则检查（unknown_template/missing_title/*_overflow/unapproved_claim/unapproved_asset/bad_color/low_contrast），通过才渲染。返回 `{ result: { posterId, passed, failures[], width?, height?, bytes? } }`。
- `GET /projects/:projectId/posters`：列表。
- `GET /projects/:projectId/posters/:id/png`：下载 PNG（Content-Type image/png）。

---

## 验收后新增/变更（2026-07-14，未提交）

**官网导入增强**
- `POST /projects/:projectId/sources/import-website` 返回 result 增加 `ragChunksEmbedded`（官网正文进 rag_chunks 的分片数）；导入时**自动抓 logo/主图**入 `visual_assets`（status=uploaded 待批准）。官网正文经 1024 维 embedding 写入 `rag_chunks`（project_id 隔离，document_id=pageId）→ search_kb 可检索。
- `PATCH /projects/:projectId/assets/:assetId/tags` 更新视觉资产标签，body 为 `{ kind, claimId }`。`kind` 的产品枚举为 `logo / hero_image / atmosphere / feature_screenshot`；旧 `product_screenshot / reference_poster / font` 仅用于历史兼容。`claimId` 可为 `null`，非空时后端强制校验卖点属于同一项目。`GET /projects/:projectId/assets` 返回项新增 `claim_id`。
- `DELETE /projects/:projectId/assets/:assetId` 删除视觉资产数据库记录及对应存储文件；接口校验当前用户拥有项目。

**AI 对话 Evidence**
- `GET /projects/:projectId/agent/runs/:runId/context` 返回 `{ runId, systemPrompt, inputMessages, evidence[] }`；`evidence` 与 Agent 文案中的 `[evidence-N]` 使用相同顺序，每项含原始 chunk `text` 与可选 `sourceRef`，供前端 hover/click 展示原文。

**视觉资产**
- `GET /projects/:projectId/assets/:id/file`：返回资产图片字节（`image/*`，前端缩略图）。

**海报**
- `POST /projects/:projectId/posters/render` body 增加 `bgImageAssetId?`（hero-image 模板背景图）。
- `POST /projects/:projectId/posters/auto`：body `{ claimId }`。自动用 产品名(标题)+卖点(文案)+已批准官网图 出海报（有主图用 hero-image 模板，否则 simple-quote+logo）。返回 `{ result: RenderResult }`。
- 新模板 `hero-image`（1080×1080，官网图打底+暗色遮罩+白字）。

**内容包**
- `POST /projects/:projectId/campaigns/:id/variants/:vid/adopt`：采纳一个角度（`adopted=true`，消费出口）。
- `GET /projects/:projectId/campaigns/:id` 的 variants 增加 `adopted` 字段。

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
