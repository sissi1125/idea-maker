# 部署指南：阿里云 ECS docker-compose

feat-013.5 — 单 VPS 全栈部署（前端 + 后端 + Postgres + Ollama + Caddy 反代）。
所有服务跑在同一台 ECS，一键启栈，自动 HTTPS。

> 旧的 Fly.io 文档已废弃，归档到 `docs/DEPLOY-flyio-legacy.md`。

---

## 架构

```
                          公网
                            │
                  Caddy (80/443)
                   ├─ {DOMAIN}        → web:3000     Next.js
                   └─ api.{DOMAIN}    → api:3001     NestJS
                                          │
                                          ├─ postgres:5432    PostgreSQL 16 + pgvector
                                          └─ ollama:11434     bge-m3 embedding
```

5 个 container 一个 docker-compose 拉起。
HTTPS 由 Caddy 自动申请 Let's Encrypt 证书（仅需 DNS 指向 ECS 公网 IP）。

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
