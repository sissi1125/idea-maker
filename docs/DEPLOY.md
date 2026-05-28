# 部署指南（Fly.io）

feat-200.8 Week 8 收官交付：把 MVP 一键部署到 Fly.io 测试环境。

## 前置准备

1. **安装 flyctl**

   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **登录**

   ```bash
   fly auth login
   ```

3. **准备 LLM / Embedding API key**

   智谱 GLM 或阿里云 Qwen 兼容 OpenAI 接口，按下面 `LLM_*` / `EMBEDDING_*` 配置即可。
   生产环境建议 embedding 也用云服务（不要本地 Ollama），否则 Fly VM 上跑 bge-m3 会卡爆。

## 一次性初始化

```bash
# 1. 创建 app（app name 全网唯一）
fly apps create idea-maker

# 2. 创建并附加 Postgres（pgvector 扩展会在第一次请求时自动 CREATE EXTENSION）
fly postgres create --name idea-maker-pg --region nrt --vm-size shared-cpu-1x --volume-size 3
fly postgres attach idea-maker-pg --app idea-maker
# ↑ 这一步自动注入 DATABASE_URL secret

# 3. 创建持久化卷（存上传的文档原文件）
fly volumes create ideamaker_data --size 3 --region nrt --app idea-maker

# 4. 写入其余 secrets
fly secrets set \
  JWT_SECRET="$(openssl rand -hex 32)" \
  LLM_API_KEY="..." \
  LLM_BASE_URL="https://open.bigmodel.cn/api/paas/v4/" \
  LLM_MODEL="glm-4-flash" \
  EMBEDDING_API_KEY="..." \
  EMBEDDING_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1" \
  EMBEDDING_MODEL="text-embedding-v4" \
  EMBEDDING_DIMENSION="1024" \
  --app idea-maker

# 5. 部署
fly deploy --app idea-maker
```

## Secrets 清单

部署前必须配齐以下 secrets：

| 名称 | 必需 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | `fly postgres attach` 自动注入 |
| `JWT_SECRET` | ✅ | ≥ 16 字符随机串，用 `openssl rand -hex 32` |
| `LLM_API_KEY` | ✅ | LLM 服务 API Key（智谱 / OpenAI / SiliconFlow 都可） |
| `LLM_BASE_URL` | ✅ | OpenAI 兼容 chat completions 端点 |
| `LLM_MODEL` | ✅ | 模型名（如 `glm-4-flash`） |
| `EMBEDDING_API_KEY` | ✅ | Embedding 服务 API Key（可与 LLM 复用） |
| `EMBEDDING_BASE_URL` | ✅ | OpenAI 兼容 embeddings 端点 |
| `EMBEDDING_MODEL` | ✅ | Embedding 模型名（如 `text-embedding-v4` / `bge-m3`） |
| `EMBEDDING_DIMENSION` | ⚠️ | 默认 1024；与已写入 pgvector 表的维度一致 |
| `CORS_ORIGIN` | ⚠️ | 允许跨域的来源；fly.toml 默认有 |
| `PYMUPDF_SERVICE_URL` | 可选 | 不配则 PDF 走 `pdf-pages` 兜底 |

## 验证部署

```bash
# health check
curl https://idea-maker.fly.dev:3001/health

# 跑 smoke 测试
API_BASE_URL=https://idea-maker.fly.dev:3001 node scripts/smoke.mjs
```

## 常见运维

```bash
# 看日志
fly logs --app idea-maker

# SSH 进容器
fly ssh console --app idea-maker

# 重启
fly apps restart idea-maker

# 查 secrets（不暴露值）
fly secrets list --app idea-maker
```

## 已知 trade-off

- **单 VM 双进程**（API + Web 在同一容器里跑）：MVP 阶段省钱；后续要扩容拆成两个 fly app
- **Embedding 走云服务**：避免 Fly shared-cpu VM 跑本地 bge-m3 卡死；用户成本可控（embedding 调用极少）
- **pgvector 扩展**：`fly postgres` 默认包含 pgvector，无需手动安装
- **文件存储**：上传的原始文档放 Fly volume，重启不丢；chunks 在 Postgres pgvector 表里
