# NestJS API 生产镜像 — feat-013.5 阿里云 ECS 部署
#
# Multi-stage：
#   1. builder：装全部 deps + 编译 TS
#   2. runner：只复制 dist + production deps，最小镜像
#
# 镜像约 200MB（vs builder 1.5GB）。
# Node 22 LTS（与 dev 一致，避免 native module ABI 差异）。
#
# 构建（从 repo 根目录运行）：
#   docker build -f apps/api/Dockerfile -t harness-api .
# 跑测：
#   docker run --rm -p 3001:3001 --env-file apps/api/.env harness-api

# ── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# pnpm 9（与本地 package.json 锁版一致）
RUN corepack enable && corepack prepare pnpm@9 --activate

# 先复制 workspace 配置和所有 package.json（让 pnpm 能解析依赖图）
# 这样 layer 缓存可以在源码变化时复用 deps install
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/rag-core/package.json packages/rag-core/
COPY packages/shared-types/package.json packages/shared-types/

# 装所有依赖（含 dev）以便编译
# --frozen-lockfile：CI 严格用 lock 版本
RUN pnpm install --frozen-lockfile

# 现在复制源码（本仓库各 tsconfig 独立，无 tsconfig.base.json）
COPY packages/rag-core/ packages/rag-core/
COPY packages/shared-types/ packages/shared-types/
COPY apps/api/ apps/api/

# 先编译内部 workspace 包（产出 dist/），再编译 api
RUN pnpm --filter @harness/shared-types build && \
    pnpm --filter @harness/rag-core build && \
    pnpm --filter @harness/api build

# 生成只含 production deps 的 node_modules
# pnpm deploy 把 workspace 包内联进来，生成可独立部署的目录
RUN pnpm --filter @harness/api deploy --prod /deploy

# ── Stage 2: Runner ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# 非 root 用户跑应用（最小权限原则）
RUN groupadd -r app && useradd -r -g app app

# 从 builder 复制 production-only deps + dist
# /deploy 包含 node_modules + package.json（workspace 包已内联）
COPY --from=builder --chown=app:app /deploy/node_modules ./node_modules
COPY --from=builder --chown=app:app /deploy/package.json ./package.json
COPY --from=builder --chown=app:app /app/apps/api/dist ./dist

# data 目录：spill 落盘 + 未来可能的本地缓存
RUN mkdir -p /app/data && chown -R app:app /app/data

USER app

EXPOSE 3001

# health check：docker compose 启动顺序依赖此端点（depends_on healthy）
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# 直接跑 dist；dotenv 不需要（生产 env 由 compose 注入）
CMD ["node", "dist/main.js"]
