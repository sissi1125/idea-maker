# Dockerfile — Idea-Maker MVP 部署镜像（feat-200.8 Week 8）
#
# 多阶段构建：
#   1. base    安装 pnpm + 系统依赖
#   2. deps    pnpm install --frozen-lockfile 拉所有 workspace 依赖
#   3. build   编译 packages/* 和 apps/api、apps/web（next build）
#   4. runner  最小运行时镜像，只复制构建产物 + 安装 production 依赖
#
# 启动两个进程：apps/api（NestJS:3001） + apps/web（Next.js standalone:3000）
# 用 dumb-init 做 PID 1 + concurrently 启两个 Node 进程。
#
# Fly.io 部署：fly deploy 自动用本文件构建。

# ─── base ──────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.6.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends \
      dumb-init ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ─── deps ──────────────────────────────────────────────────────────────────
# 单独一层装依赖，方便缓存（源码变更不重新装包）
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/rag-core/package.json packages/rag-core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

# ─── build ─────────────────────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared-types/node_modules ./packages/shared-types/node_modules
COPY --from=deps /app/packages/rag-core/node_modules ./packages/rag-core/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .

# 关键：Next.js 用 standalone 输出，减少运行时镜像体积
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm -r build && \
    cd apps/web && pnpm exec next build

# ─── runner ────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PORT=3001
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.6.0 --activate
RUN apt-get update && apt-get install -y --no-install-recommends \
      dumb-init ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app

# NestJS 编译产物 + 运行时 deps（dist + node_modules）
COPY --from=build /app/apps/api/dist                    /app/apps/api/dist
COPY --from=build /app/apps/api/package.json            /app/apps/api/package.json
COPY --from=build /app/apps/api/node_modules            /app/apps/api/node_modules
COPY --from=build /app/apps/api/src/pipeline-orchestrator/pipelines \
                                                        /app/apps/api/dist/pipeline-orchestrator/pipelines
COPY --from=build /app/packages/shared-types/dist       /app/packages/shared-types/dist
COPY --from=build /app/packages/shared-types/package.json /app/packages/shared-types/package.json
COPY --from=build /app/packages/rag-core/dist           /app/packages/rag-core/dist
COPY --from=build /app/packages/rag-core/package.json   /app/packages/rag-core/package.json

# Next.js standalone 输出（含必要的 node_modules）
COPY --from=build /app/apps/web/.next/standalone        /app/apps/web/
COPY --from=build /app/apps/web/.next/static            /app/apps/web/.next/static
COPY --from=build /app/apps/web/public                  /app/apps/web/public

# 启动脚本：并发启动 API + Web
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 数据目录（ingestion 上传文件落盘的位置；Fly volume 挂这里）
RUN mkdir -p /app/apps/api/data/uploads
VOLUME ["/app/apps/api/data"]

EXPOSE 3000 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:3001/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["docker-entrypoint.sh"]
