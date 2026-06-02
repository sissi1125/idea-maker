#!/usr/bin/env bash
# 阿里云 ECS 部署脚本 — feat-013.5
#
# 在 ECS 上首次部署：
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/scripts/deploy-vps.sh | bash
# 或：
#   git clone https://github.com/<you>/<repo>.git
#   cd <repo>
#   ./scripts/deploy-vps.sh
#
# 后续更新：
#   git pull && ./scripts/deploy-vps.sh

set -euo pipefail

# ── 颜色输出 ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;36m'; NC='\033[0m'
log() { echo -e "${BLUE}▶${NC} $1"; }
ok()  { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
die() { echo -e "${RED}✗${NC} $1"; exit 1; }

# ── 检查环境 ─────────────────────────────────────────────────────────────
log "检查 Docker"
command -v docker >/dev/null 2>&1 || die "Docker 未装。Ubuntu: curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 未装。装 docker-compose-plugin"
ok "Docker $(docker --version | cut -d' ' -f3)"

# ── 检查 .env.production ──────────────────────────────────────────────────
ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.prod.yml"

if [ ! -f "$ENV_FILE" ]; then
  if [ -f ".env.production.example" ]; then
    warn ".env.production 不存在，复制模板"
    cp .env.production.example .env.production
    die "请先编辑 .env.production 填入真实值，再重跑本脚本"
  fi
  die "缺 .env.production 和 .env.production.example"
fi

[ -f "$COMPOSE_FILE" ] || die "缺 $COMPOSE_FILE"
[ -f "Caddyfile" ] || die "缺 Caddyfile"

# ── 校验关键 env ─────────────────────────────────────────────────────────
log "校验 .env.production 必填项"
# 用 grep 检查，不 source（避免 secret 在 ps 里被看到）
required_vars=(DOMAIN ACME_EMAIL DB_PASSWORD JWT_SECRET LLM_API_KEY LLM_BASE_URL LLM_MODEL)
for v in "${required_vars[@]}"; do
  if ! grep -qE "^${v}=.+$" "$ENV_FILE"; then
    die "$ENV_FILE 缺 $v 或值为空"
  fi
  val=$(grep -E "^${v}=" "$ENV_FILE" | head -1 | cut -d'=' -f2-)
  if [[ "$val" == *"change-me"* ]] || [[ "$val" == *"your-"* ]]; then
    die "$v 看起来还是模板默认值，请填真实值"
  fi
done
ok "env 关键字段都填了"

# ── 构建镜像 ─────────────────────────────────────────────────────────────
log "构建 api + web 镜像（首次约 5-10 分钟）"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build api web
ok "镜像构建完成"

# ── 启动栈 ───────────────────────────────────────────────────────────────
log "启动所有服务"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

ok "栈已起。查看状态："
echo "  docker compose -f $COMPOSE_FILE ps"

# ── 首次部署：拉 ollama 模型 ─────────────────────────────────────────────
log "等 ollama 健康（最多 60s）"
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" ps ollama 2>/dev/null | grep -q "healthy\|running"; then
    break
  fi
  sleep 2
done

log "检查 bge-m3 模型是否已 pull"
if ! docker compose -f "$COMPOSE_FILE" exec -T ollama ollama list 2>/dev/null | grep -q "bge-m3"; then
  warn "首次部署需 pull bge-m3 模型（约 600MB，需 1-3 分钟）"
  docker compose -f "$COMPOSE_FILE" exec -T ollama ollama pull bge-m3
  ok "bge-m3 已就绪"
else
  ok "bge-m3 已在 ollama 里"
fi

# ── 健康检查 ─────────────────────────────────────────────────────────────
log "等 API health"
DOMAIN=$(grep -E "^DOMAIN=" "$ENV_FILE" | cut -d'=' -f2)
sleep 5
for i in $(seq 1 12); do
  if docker compose -f "$COMPOSE_FILE" exec -T api node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1))" >/dev/null 2>&1; then
    ok "API health 200"
    break
  fi
  sleep 5
  [ "$i" = "12" ] && warn "API health 超时——查日志 docker compose -f $COMPOSE_FILE logs api"
done

cat <<EOF

${GREEN}部署完成${NC}

下一步：
  1. 确认 DNS：
     dig $DOMAIN
     dig api.$DOMAIN
  2. 浏览器访问（Caddy 会自动申请证书，首次 ~30s）：
     https://$DOMAIN
     https://api.$DOMAIN/health
  3. 跑 e2e smoke：
     API_BASE_URL=https://api.$DOMAIN node scripts/smoke.mjs
  4. 看日志：
     docker compose -f $COMPOSE_FILE logs -f --tail=100
  5. 更新代码后重新部署：
     git pull && ./scripts/deploy-vps.sh
EOF
