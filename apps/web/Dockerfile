# Next.js 16 Web 生产镜像 — feat-013.5 阿里云 ECS 部署
#
# 使用 Next.js `output: 'standalone'`（已在 next.config.ts 设置）：
#   - .next/standalone 自带最小 node_modules + server.js
#   - 镜像 < 250MB
#
# 构建（从 repo 根目录运行）：
#   docker build -f apps/web/Dockerfile -t harness-web .
# 跑测：
#   docker run --rm -p 3000:3000 \
#     -e NEXT_PUBLIC_API_URL=https://api.example.com \
#     harness-web

# ── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

# Workspace 配置 + 所有 package.json（让 pnpm 解析依赖图）
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/rag-core/package.json packages/rag-core/
COPY packages/shared-types/package.json packages/shared-types/

RUN pnpm install --frozen-lockfile

# 源码（本仓库各 tsconfig 独立，无 tsconfig.base.json）
COPY packages/rag-core/ packages/rag-core/
COPY packages/shared-types/ packages/shared-types/
COPY apps/web/ apps/web/

# 生产构建。NEXT_PUBLIC_* 必须在 build time 注入（编译进 JS bundle）
# 注意：DOCKER_BUILDKIT=1 + --build-arg NEXT_PUBLIC_API_URL=https://... 才生效
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# 关闭 telemetry，加速 build
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @harness/web build

# ── Stage 2: Runner ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd -r app && useradd -r -g app app

# Next.js standalone 输出包含 server.js + 最小 node_modules
# outputFileTracingRoot=monorepo 根 → standalone 路径是 apps/web/.next/standalone
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=app:app /app/apps/web/public ./apps/web/public

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.ok || r.status === 307 ? 0 : 1)).catch(() => process.exit(1))"

# standalone server.js 在 monorepo 路径下
CMD ["node", "apps/web/server.js"]
