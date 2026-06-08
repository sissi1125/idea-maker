# 部署指南：Vercel + 阿里云 ECS + Cloudflare Named Tunnel

feat-013.5 — **Phase 2 实际生产架构**（2026-06 上线）。
- 前端：Vercel CDN（免费、自动 SSL、零运维）
- 后端：阿里云 ECS（1C/2GB Alibaba Cloud Linux 3）docker compose
- 反向代理：Cloudflare Named Tunnel（出站隧道，无入站端口、零备案）
- LLM + Embedding：智谱 GLM（云端 API，1C/2GB ECS 跑不起本地 ollama）

> Phase 1 旧方案（单 ECS + Caddy + Ollama 全栈）保留在 `docker-compose.prod.yml` + `docs/DEPLOY-PLAN.md`，作为 fallback。
> Fly.io 方案归档到 `docs/DEPLOY-flyio-legacy.md`。

---

## Phase 2 架构

```
                  浏览器
                    │ HTTPS
            Vercel CDN（Next.js standalone）
                    │ HTTPS
        https://api.retreevo.online
                    │ DNS CNAME
        Cloudflare 边缘节点（自动 SSL、TLS 终结）
                    │ 加密隧道（出站长连接）
                ECS：cloudflared 容器（无入站端口）
                    │ docker bridge network
                ┌───┴────┐
            api:3001    postgres:5432
            （NestJS）  （pgvector）
                │
                └→ 智谱云端 API
                   embedding-3 + GLM-4-flash
```

**关键设计**：
- ECS **不开任何入站端口**（cloudflared 出站建连，类似 SSR 客户端）
- 域名挂在 Cloudflare，**无需备案**（流量入口是 CF 边缘节点，不是 ECS IP）
- Quick Tunnel 调试 → Named Tunnel 生产（URL 固定，重启不变）
- 本地 ollama → 云端智谱 embedding，节省 ~600MB 内存
- 全链路 SSE（Agent Trace 实时流）通过 Cloudflare Tunnel 验证可行

---

## Phase 2 部署步骤

### 0. 前置准备

- ECS：1C/2GB 起，能上外网（cloudflared 走出站）
- 域名：托管到 Cloudflare（任何 TLD，腾讯云/阿里云域名都行，**无需备案**）
- 智谱 API key：[bigmodel.cn](https://open.bigmodel.cn) 注册按量充值即可
- Vercel + Cloudflare 账号

### 1. ECS 上 docker + compose

```bash
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

### 2. 配置 .env

```bash
git clone <你的仓库> /var/www/html/idea-maker  # 或 scp
cd /var/www/html/idea-maker
cp .env.production.example .env
chmod 600 .env
vim .env
```

**关键字段**（带 ⚠️ 的必改）：

```bash
DB_PASSWORD=$(openssl rand -hex 24)              # ⚠️ 用 hex 避免 URL 特殊字符
JWT_SECRET=$(openssl rand -base64 48)            # ⚠️
CORS_ORIGIN=https://你的项目.vercel.app          # ⚠️ Vercel 部署完回填
LLM_API_KEY=4e277xxx.ABzBixxx                    # ⚠️ 智谱真实 key
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
LLM_MODEL=glm-4-flash
EMBEDDING_API_KEY=4e277xxx.ABzBixxx              # ⚠️ 同上（不要写 ${LLM_API_KEY}，.env 不展开变量）
EMBEDDING_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
EMBEDDING_MODEL=embedding-3
EMBEDDING_DIMENSION=1024
```

### 3. Cloudflare Named Tunnel 配置

```bash
# 装 cloudflared（Alibaba Cloud Linux 用 rpm）
curl -L --output cloudflared.rpm https://ghproxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm
rpm -ivh cloudflared.rpm

# 登录（输出 URL 在本地浏览器打开授权）
cloudflared tunnel login

# 创建 tunnel
cloudflared tunnel create idea-maker-api
# 记下 UUID

# 绑定子域名（自动加 CF DNS CNAME）
cloudflared tunnel route dns idea-maker-api api.你的域名.com

# 写 config.yml + 复制到容器可读位置
UUID=$(basename /root/.cloudflared/*.json .json)
cat > /etc/cloudflared/config.yml <<EOF
tunnel: $UUID
credentials-file: /etc/cloudflared/$UUID.json

ingress:
  - hostname: api.你的域名.com
    service: http://api:3001
  - service: http_status:404
EOF
cp /root/.cloudflared/$UUID.json /etc/cloudflared/
chmod 755 /etc/cloudflared && chmod 644 /etc/cloudflared/*
```

### 4. 启动栈

```bash
docker compose -f docker-compose.named-tunnel.yml up -d
sleep 15
docker compose -f docker-compose.named-tunnel.yml logs cloudflared --tail 20
curl -i https://api.你的域名.com/health  # 期望 200
```

### 5. Vercel 部署前端

[Vercel](https://vercel.com) → Import 仓库 → 配置：

| 字段 | 值 |
|---|---|
| Root Directory | `apps/web` |
| Install Command | `cd ../.. && pnpm install --frozen-lockfile --prod=false` |
| Build Command | `cd ../.. && pnpm --filter @harness/shared-types build && pnpm --filter @harness/rag-core build && pnpm --filter @harness/web build` |
| Environment Variables | `NEXT_PUBLIC_API_URL=https://api.你的域名.com` |

Deploy → 拿到 `https://xxx.vercel.app` → 回填 ECS `.env` 的 `CORS_ORIGIN` → 重启 api。

---

## 验收

```bash
curl https://api.你的域名.com/health          # ECS api 通
```
浏览器：注册 → 创建项目 → 上传文档 → Agent 模式发消息 → Trace 实时流出 step。

---

## ⚠️ 旧方案（Phase 1）以下章节保留作为 fallback 参考

如果你想用单 ECS Caddy 全栈方案（前提：4GB+ 内存、有域名）：

---

## 1. 准备 ECS

### 推荐规格
- **2C / 4GB RAM / 40GB SSD**（够跑 bge-m3 + Postgres + API + Web）
- **1C / 2GB** 也能跑（紧张，需调 swap）
- 系统：**Ubuntu 22.04 LTS** 或 **Debian 12**
- 安全组放开端口：**22（SSH）/ 80（HTTP）/ 443（HTTPS）**

### 域名 DNS 准备

在域名解析处加 2 条 A 记录（或 1 条主域，看你想要什么子域）：

| 类型 | 主机记录 | 解析值 |
|---|---|---|
| A | `@`（或 `idea-maker`）| ECS 公网 IP |
| A | `api`（或 `idea-maker-api`）| ECS 公网 IP |

例如：
- `idea-maker.example.com` → 前端
- `api.idea-maker.example.com` → 后端

阿里云用户：在「域名 → 解析设置」加 A 记录，TTL 默认 10 分钟。

---

## 2. 在 ECS 装 Docker

SSH 登 ECS：

```bash
# Ubuntu / Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

> 国内访问 Docker Hub 慢时，可配镜像加速器（阿里云 ACR 提供个人免费）。
> 编辑 `/etc/docker/daemon.json`：
> ```json
> { "registry-mirrors": ["https://<your-id>.mirror.aliyuncs.com"] }
> ```
> 然后 `sudo systemctl restart docker`。

---

## 3. 拉取项目

```bash
git clone https://github.com/<you>/idea-maker.git
cd idea-maker
```

> 如果项目还没推 GitHub，本地 `scp -r ./ user@ecs:~/idea-maker/` 也行。

---

## 4. 配置 `.env.production`

```bash
cp .env.production.example .env.production
vim .env.production
```

**必填项**：
- `DOMAIN` — 你的域名（不带 `https://`，例：`idea-maker.example.com`）
- `ACME_EMAIL` — Let's Encrypt 通知邮箱
- `DB_PASSWORD` — 数据库强密码（`openssl rand -base64 32` 生成）
- `JWT_SECRET` — JWT 签名 secret（`openssl rand -base64 48` 生成）
- `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` — 你的 LLM provider

**可选**：
- `TAVILY_API_KEY` — 不填则 search_web tool 降级返回空

详细模板见 `.env.production.example` 注释。

---

## 5. 一键部署

```bash
./scripts/deploy-vps.sh
```

这个脚本会：
1. 校验 Docker / .env 关键字段
2. 构建 api + web 镜像（首次 ~5-10 分钟）
3. `docker compose up -d` 起栈
4. 自动 `ollama pull bge-m3`（首次约 600MB，1-3 分钟）
5. 等 API health check
6. 打印验证步骤

---

## 6. 验证

```bash
# 1. 服务都起来了
docker compose -f docker-compose.prod.yml ps
# 应当看到 caddy / postgres / ollama / api / web 都 healthy

# 2. Caddy 申请证书完成（首次约 30s）
docker compose -f docker-compose.prod.yml logs caddy | grep "certificate obtained"

# 3. 浏览器访问
open https://${DOMAIN}/
open https://api.${DOMAIN}/health    # 应看 {"status":"ok",...}

# 4. e2e smoke（17 步全栈）
API_BASE_URL=https://api.${DOMAIN} node scripts/smoke.mjs
```

---

## 7. 日常运维

### 看日志
```bash
docker compose -f docker-compose.prod.yml logs -f --tail=100             # 全部
docker compose -f docker-compose.prod.yml logs -f api                    # 单服务
```

### 重启某服务
```bash
docker compose -f docker-compose.prod.yml restart api
```

### 更新代码
```bash
git pull
./scripts/deploy-vps.sh
# 脚本会重新 build 改动的镜像 + 滚动重启
```

### DB 备份
```bash
# dump
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres rag > backup-$(date +%Y%m%d).sql

# 恢复
cat backup-20260602.sql | docker compose -f docker-compose.prod.yml \
  exec -T postgres psql -U postgres rag
```

### 看磁盘
```bash
docker system df             # docker 占用
df -h                        # 全机
du -sh /var/lib/docker/volumes/   # volumes 大小（Postgres / Ollama 数据）
```

### 清理无用镜像
```bash
docker system prune -a       # 删未在用的镜像（小心，会 5min 重建）
```

---

## 8. 排错速查

### 证书申请失败（`Caddy logs` 反复重试）
- DNS 还没生效：`dig ${DOMAIN}` 确认指向 ECS 公网 IP
- 80/443 没开：阿里云安全组检查
- ACME_EMAIL 格式错：必须是合法 email

### API 502 / 启动失败
```bash
docker compose -f docker-compose.prod.yml logs api | tail -50
```
常见：
- DATABASE_URL 错（看 postgres 容器是否 healthy）
- JWT_SECRET < 16 字符
- LLM_API_KEY 错（启动不报，runtime 调用才挂）

### Ollama bge-m3 没装
```bash
docker compose -f docker-compose.prod.yml exec ollama ollama list
# 看不到 bge-m3 → 手动 pull：
docker compose -f docker-compose.prod.yml exec ollama ollama pull bge-m3
```

### SSE trace 不流（前端卡"启动中"）
- Caddy `flush_interval -1` 已配，不应是它的问题
- 检查浏览器 DevTools Network 看 `/agent/runs/.../stream` 状态码
- 如反向代理在 Caddy 之前还有一层（阿里云 SLB），需关闭对 SSE 的 buffer

### 内存压力（2GB ECS）
观察 `docker stats`。如 Ollama 占用 > 1GB：
- 换更小 embedding 模型（如 `all-minilm`，384 维，但需改 DDL）
- 或换云端 embedding（智谱 embedding-3 1024 维，与 DDL 兼容）

---

## 9. 简历加分点（部署故事）

如果面试官问"你是怎么部署上线的"，答案：

> "全栈单 ECS docker-compose 部署：5 个 container（Caddy / Postgres+pgvector / Ollama+bge-m3 / NestJS API / Next.js Web）。Caddy 自动 Let's Encrypt 让生产 HTTPS 零配置。Ollama 跑在容器内做本地 embedding，避免依赖外部 embedding API 的额度限制和延迟。
>
> 设计取舍：
> - **单 VPS vs 多平台**（Vercel + Railway 等）：单 VPS 网络延迟更低（一台机器内通信），CORS 配置零样板，运维统一。代价是没有 CDN 加速——但简历项目国内访问够用。
> - **Caddy vs Nginx**：自动证书省 90% 配置，Caddyfile 30 行 vs nginx.conf 100+ 行。
> - **Next.js standalone output**：镜像 250MB vs 全量 1GB+。
>
> 部署脚本 `deploy-vps.sh` 做了 env 校验 + 健康检查 + 自动 ollama pull，新人能一键起来。这是从 HR/面试官视角设计的：点开仓库 5 分钟能看到 demo URL。"

---

## 10. 成本（参考）

阿里云 ECS（仅供参考，价格随时变）：

| 配置 | 月费（含国内带宽） |
|---|---|
| 2C / 4GB / 40GB SSD（按量） | ~150 元 |
| 2C / 4GB / 40GB SSD（包年）| ~80 元/月 |
| 1C / 2GB（学生机 / 突发性能 t6） | 40-60 元 |

LLM 调用费用（智谱 GLM-4-flash 实测）：
- 单次 agent run ≈ ¥0.001
- 单次 `pnpm eval`（5 条 golden）≈ ¥0.005
- 一个月 demo 用 100 次 ≈ ¥0.1

**总计：月成本 < 100 元**，主要在 ECS。
