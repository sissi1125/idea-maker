# 部署方案文档（feat-013.5）

> **文档定位**：从「为什么这么部署」到「上线后怎么活」的全周期方案。
> 不是 step-by-step 指南（那个看 [`DEPLOY.md`](DEPLOY.md)），是**方案设计 + 决策记录 + 运维手册**。

---

## ⚠️ Phase 2 架构变更（2026-06）

实际生产采用 **Vercel 前端 + 阿里云 ECS 后端 + Cloudflare Named Tunnel** 混合架构，不是本文 §3 的单 ECS 全栈。
变更原因：
- 1C/2GB ECS 内存吃紧（本地 ollama bge-m3 OOM）→ 改云端智谱 embedding-3
- 无固定公网域名 + 不想备案 → Cloudflare Tunnel（出站隧道，零入站端口）
- 前端独立 CDN 加速 + 零运维 → Vercel

**新架构详情、踩坑复盘、面试讲解**：
- `docs/DEPLOY.md` — Phase 2 step-by-step 部署指南
- `docs/DEPLOYMENT_RETROSPECTIVE.md` — 11 个坑的踩坑复盘
- `docs/DEPLOYMENT_PLAIN_TALK.md` — 1000 字大白话讲架构

**本文档（DEPLOY-PLAN.md）保留为**：
- 单 ECS 全栈方案的完整决策记录（Phase 1 备选 / fallback）
- §8 安全 / §10 备份 / §11 回滚 / §12 容量规划 等通用章节仍然适用
- §13 成本预算需结合 Phase 2 重算（Vercel 免费 + Cloudflare 免费 → 实际仅 ECS 费用 + LLM/embedding 按量）

---

---

## 目录

0. [文档导读](#0-文档导读)
1. [部署目标与不目标](#1-部署目标与不目标)
2. [决策框架（4 个关键技术选择）](#2-决策框架4-个关键技术选择)
3. [架构图与流量路径](#3-架构图与流量路径)
4. [前置准备清单](#4-前置准备清单)
5. [制品清单（已交付）](#5-制品清单已交付)
6. [部署步骤（详细）](#6-部署步骤详细)
7. [验收清单](#7-验收清单)
8. [安全考量](#8-安全考量)
9. [监控与日志](#9-监控与日志)
10. [备份与恢复](#10-备份与恢复)
11. [回滚预案](#11-回滚预案)
12. [性能与容量规划](#12-性能与容量规划)
13. [成本预算](#13-成本预算)
14. [故障预案与排错手册](#14-故障预案与排错手册)
15. [升级路径](#15-升级路径)
16. [简历讲故事的角度](#16-简历讲故事的角度)

---

## 0. 文档导读

| 你的角色 | 看哪里 |
|---|---|
| 第一次要部署 | §4 准备 → §6 步骤 → §7 验收 |
| 部署后日常运维 | §9 监控 → §10 备份 → §14 排错 |
| 出问题要回滚 | §11 回滚预案 |
| 准备面试讲这个 | §2 决策 → §16 讲故事 |
| 想升级到 Phase 5（多租户 / CI/CD 等） | §15 升级路径 |

---

## 1. 部署目标与不目标

### 目标 ✅
1. **可演示**：HR / 面试官点击链接 30 秒内能看到 UI、发消息触发 agent、看 trace 实时流
2. **可观测**：日志能看到所有 agent 决策路径
3. **零证书运维**：自动 HTTPS（Let's Encrypt 续期由 Caddy 处理）
4. **低成本**：月成本 < 100 元（仅 ECS 费用）
5. **可回滚**：上线出问题 5 分钟内回到上一个版本
6. **可解释**：部署架构能写进简历，每个决策都有 "为什么"

### 不目标 ❌
1. **高可用**（多 AZ / 自动 failover）：单 VPS 单点故障可接受，简历项目不是生产服务
2. **CDN 加速**：国内访问够用，没必要为 demo 引入 CloudFlare/Vercel CDN
3. **数据库高可用**：单 Postgres 实例够用，备份策略足够
4. **服务网格** / **K8s**：杀鸡用牛刀，5 个 container 用 docker-compose 即可
5. **多租户隔离**：当前 RBAC 是 user-level，没做 workspace 多租户（feat-013.2 待办）
6. **CI/CD**：手动 `git pull && ./deploy-vps.sh` 够用；自动化留 §15 升级路径

---

## 2. 决策框架（4 个关键技术选择）

### 决策 A — 部署平台

| 选项 | 优势 | 代价 | 选择 |
|---|---|---|---|
| **阿里云 ECS docker-compose** | 用户已有机器；CORS 简单；单机延迟低 | 自己管 SSL / 备份 / 监控 | ✅ **本方案** |
| Vercel + Railway + Supabase | 前端 CDN；零运维；自动部署 | 多平台拼接、CORS、Railway 收费 ~$10/月 | ❌ 拒绝（成本与决策复杂度）|
| Fly.io 多服务 | 配置一致；Postgres 内置 | 国内访问慢；ollama 不易塞进 fly machine（内存限制）| ❌ 拒绝（embedding 痛点）|
| Render | 全栈三服务一站式 | 免费 tier 会冷启动 30s+ | ❌ 拒绝（面试现场不能冷启动）|

**核心理由**：用户已有阿里云 ECS → 边际成本为零；ollama 本地 embedding 在 ECS 跑无任何限制；CORS 同源（仅子域）配置极简。

### 决策 B — 反向代理与 SSL

| 选项 | 优势 | 代价 | 选择 |
|---|---|---|---|
| **Caddy** | Caddyfile 30 行；自动 Let's Encrypt；HTTP/3 内置；SSE 友好 | 社区不如 Nginx 大 | ✅ **本方案** |
| Nginx + certbot | 业界标准 | nginx.conf 100+ 行；证书需自己 cron 续期；SSE 需手配 `proxy_buffering off` | ❌ 拒绝（运维成本）|
| Traefik | K8s 生态适配 | docker-compose 场景过于复杂 | ❌ 拒绝（杀鸡用牛刀）|

### 决策 C — Embedding 服务

| 选项 | 优势 | 代价 | 选择 |
|---|---|---|---|
| **容器内 ollama + bge-m3** | 与本地 dev 一致；无 API 调用费；1024 维与 DDL 兼容 | 占 ~600MB RAM | ✅ **本方案** |
| OpenAI text-embedding-3-small | 质量高 | 1536 维需改 DDL；按量付费 | ❌ 拒绝（破坏 dim 兼容）|
| 智谱 embedding-3（云端） | 1024 维兼容；与现有 GLM key 复用 | 增加云端依赖；网络抖动影响 search_kb | 🟡 备选（ECS 内存吃紧时）|

### 决策 D — Postgres

| 选项 | 优势 | 代价 | 选择 |
|---|---|---|---|
| **同 ECS 容器内 bitnami/postgresql + pgvector** | 零外部依赖；备份脚本简单；与 ollama 同 network 延迟 < 1ms | 单点故障 | ✅ **本方案** |
| 阿里云 RDS PostgreSQL | 自动备份、监控、高可用 | 月费 60+ 元；pgvector 需开通插件 | ❌ 拒绝（成本）|
| Supabase | 免费 + 自带 Studio UI | 跨平台 latency；免费 tier 限额 | ❌ 拒绝（决策一致性，避免混合架构）|

---

## 3. 架构图与流量路径

### 物理架构

```
                        Internet
                            │
                            │ HTTPS (443)
                            ↓
                ┌──────────────────────┐
                │       ECS VPS        │
                │  ┌────────────────┐  │
                │  │  Caddy 2       │  │  反向代理 + Let's Encrypt
                │  │  80/443 公网    │  │
                │  └───────┬────────┘  │
                │          │           │
                │  ┌───────┴──────┐    │  Docker bridge network: prod
                │  │              │    │
                │  ↓              ↓    │
                │ web:3000   api:3001  │
                │ Next.js    NestJS    │
                │              │       │
                │              ├──→ postgres:5432  PG16 + pgvector
                │              │
                │              └──→ ollama:11434   bge-m3 (1024d)
                │                                                │
                │  Volumes:                                       │
                │   postgres_data       (DB 数据，~100MB)         │
                │   ollama_data         (bge-m3 模型，~600MB)     │
                │   caddy_data          (Let's Encrypt 证书)      │
                │   caddy_config        (Caddy 运行时配置)        │
                └──────────────────────┘
                            │
                            ↑ HTTPS API call
                  External:  GLM / OpenAI / DeepSeek
                            （LLM provider，BYOK）
```

### 流量路径（典型 agent run）

```
1. 用户浏览器
   ↓ https://idea-maker.example.com/projects/xxx
2. Caddy（443） 
   ↓ reverse_proxy web:3000
3. Next.js web container
   ↓ 返回 HTML/JS
4. 浏览器执行 useAgentRun hook
   ↓ POST https://api.idea-maker.example.com/projects/xxx/agent/run
5. Caddy（api.* 路由）
   ↓ reverse_proxy api:3001
6. NestJS api container
   ↓ runner.startInBackground (142ms 返回 runId)
7. 后台 ReAct 主循环
   ├─ search_kb tool → 走 ollama:11434 embedding → postgres pgvector 检索
   ├─ generate_draft tool → 走 LLM provider 公网（GLM/OpenAI）
   └─ 每步 emit step → AgentSseService ReplaySubject 缓冲
8. 浏览器
   ↓ EventSource https://api.idea-maker.example.com/projects/xxx/agent/runs/yyy/stream
9. Caddy (flush_interval -1)
   ↓ SSE 流不缓冲，逐帧透传
10. api container
   ↓ ReplaySubject 推送已缓冲事件 + 后续实时事件
11. 浏览器渲染 AgentTracePanel
```

### 关键设计点

| 点 | 设计 | 为什么 |
|---|---|---|
| 内部服务不暴露主机端口 | postgres / ollama / api / web 都没 `ports:` | 攻击面最小化，只有 Caddy 80/443 暴露 |
| Caddy `flush_interval -1` | 立即转发 SSE 帧 | 防 trace 卡顿（默认 buffer 会攒帧） |
| HTTP/3 启用 | UDP 443 也开 | 移动端弱网体验 |
| 内部网络 `prod` | 单一 bridge network | service name 自动 DNS（`postgres` 就是 host） |
| Volumes 命名而非 bind mount | docker manages | 备份脚本只需 dump 关心数据，不污染主机文件系统 |

---

## 4. 前置准备清单

### 4.1 ECS 规格

| 配置 | 推荐场景 | RAM 分配预估 |
|---|---|---|
| 2C / 4GB / 40GB SSD | ⭐ 推荐 | ollama 800MB + postgres 400MB + api 300MB + web 200MB + caddy 50MB + 系统 1GB = ~2.7GB 用 |
| 1C / 2GB | 最小可跑 | 需配 swap；agent 并发 1-2 个 |
| 2C / 8GB | 富余 | 适合 demo 高峰期或留缓冲 |

**系统**：Ubuntu 22.04 LTS（项目内只测过这版）/ Debian 12 也行。

**带宽**：1Mbps 起够 demo；如需流畅 SSE，建议按量计费弹性带宽。

### 4.2 域名

- 拥有一个域名（任意注册商，含阿里云万网 / Namesilo / Porkbun 等）
- 用 `*.idea-maker.example.com` 子域，避免占主域

### 4.3 DNS 解析配置

在域名后台加 2-3 条 A 记录：

| 类型 | 主机记录 | 解析值 | TTL | 说明 |
|---|---|---|---|---|
| A | `@`（或 `idea-maker`）| ECS 公网 IP | 600 | 前端入口 |
| A | `api`（或 `idea-maker-api`）| ECS 公网 IP | 600 | 后端入口 |
| A | `www` | ECS 公网 IP | 600 | 可选，跳转主域 |

**验证 DNS 已生效**：
```bash
dig idea-maker.example.com +short        # 应返回 ECS IP
dig api.idea-maker.example.com +short    # 应返回 ECS IP
```

### 4.4 ECS 安全组（阿里云控制台 → 实例 → 安全组）

**入方向放开**：

| 协议 | 端口 | 授权对象 | 说明 |
|---|---|---|---|
| TCP | 22 | 你的家庭/办公 IP（推荐）或 0.0.0.0/0 | SSH |
| TCP | 80 | 0.0.0.0/0 | HTTP（Let's Encrypt ACME 验证需要）|
| TCP | 443 | 0.0.0.0/0 | HTTPS |
| UDP | 443 | 0.0.0.0/0 | HTTP/3 QUIC |

**其他端口都不开**：postgres / ollama / api / web 都不暴露公网，只通过 Caddy 暴露。

### 4.5 LLM Provider 钱包

至少充值一项：

| Provider | 充值最少 | 单次 agent 成本（参考） |
|---|---|---|
| 智谱 GLM-4-flash | 10 元 | ~¥0.001 |
| OpenAI gpt-4o-mini | $5 | ~$0.001 |
| DeepSeek deepseek-chat | 10 元 | ~¥0.0015 |

**计算公式**：单次 ReAct 6 步 ≈ 6000 input + 1500 output token ≈ ¥0.001（GLM）/ $0.0006（OpenAI）。月内调用 1000 次预算 < ¥10。

### 4.6 GitHub 仓库（可选但推荐）

如果走 `git clone` 部署：
- 推 GitHub 私库或公库
- 准备 PAT 或 SSH key 让 ECS 能 clone

如果走 scp 部署：
- 本地 build & rsync 也可

### 4.7 前置准备 Checklist

部署前请确认：

- [ ] ECS 已创建并能 SSH 登录
- [ ] 域名 DNS 解析已配置（dig 验证返回 ECS IP）
- [ ] 安全组放开 22 / 80 / 443（TCP）+ 443（UDP）
- [ ] LLM provider 充值 ≥ 10 元
- [ ] 本地代码已 commit + push（或备好 scp 方案）
- [ ] 知道 ECS 公网 IP / SSH 用户名

---

## 5. 制品清单（已交付）

部署所需文件已在 commit `501a07d` 落地，本仓库内：

```
apps/api/Dockerfile               # multi-stage NestJS 生产镜像
apps/web/Dockerfile               # Next.js standalone 生产镜像
.dockerignore                      # 构建上下文排除
docker-compose.prod.yml            # 5 容器编排
Caddyfile                          # 反向代理 + 自动 SSL 配置
.env.production.example            # 环境变量模板
scripts/deploy-vps.sh              # 一键部署脚本（执行权限已加）
docs/DEPLOY.md                     # step-by-step 快速参考
docs/DEPLOY-PLAN.md                # 本文档（完整方案）
docs/DEPLOY-flyio-legacy.md        # 旧 Fly.io 方案归档（不再用）
```

**镜像规格**（本地构建实测）：

| 镜像 | 大小 | 主要组成 |
|---|---|---|
| harness-api | 251 MB | Node 22 base 180MB + node_modules 60MB + dist 5MB |
| harness-web | 92 MB | Node 22 base 75MB + .next/standalone 15MB |

---

## 6. 部署步骤（详细）

### 6.1 流程图

```
┌─────────────┐    ┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│ SSH 登 ECS  │ →  │ 装 Docker   │ →  │ clone/scp    │ →  │ 配 .env    │
└─────────────┘    └─────────────┘    │ 代码         │    └──────┬──────┘
                                       └──────────────┘           │
                                                                  ↓
                                            ┌──────────────┐    ┌─────────────┐
                                            │ Caddy 申请    │ ←  │ 一键部署     │
                                            │ SSL 证书     │    │ deploy-vps  │
                                            └──────┬───────┘    └─────────────┘
                                                   │
                                                   ↓
                                            ┌──────────────┐
                                            │ smoke 验收   │
                                            └──────────────┘
```

### 6.2 Step 1 — SSH 登录 ECS

```bash
ssh root@<ecs-public-ip>     # 或非 root 用户
```

更新系统：
```bash
sudo apt update && sudo apt upgrade -y
```

### 6.3 Step 2 — 装 Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker      # 不需要重新登录即可使用 docker
docker --version
docker compose version
```

**国内拉镜像慢的话** 配阿里云镜像加速器：
```bash
# 1. 登录阿里云 → 容器镜像服务 → 镜像加速器 → 复制你的专属地址
# 2. 编辑 /etc/docker/daemon.json：
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://<你的-id>.mirror.aliyuncs.com"]
}
EOF
sudo systemctl restart docker
```

### 6.4 Step 3 — 拉取项目

**A. 走 GitHub clone**（推荐）：
```bash
cd /opt    # 或你想要的部署根目录
git clone https://github.com/<your-user>/idea-maker.git
cd idea-maker
```

**B. 走 scp 推送**：
本地执行：
```bash
rsync -avz --exclude node_modules --exclude .next --exclude .git \
  ./ root@<ecs-ip>:/opt/idea-maker/
```

### 6.5 Step 4 — 配置 `.env.production`

```bash
cp .env.production.example .env.production
vim .env.production
```

**必填字段**（缺一不可）：

```bash
# 你的域名（不带 https://）
DOMAIN=idea-maker.example.com

# Let's Encrypt 通知邮箱
ACME_EMAIL=you@example.com

# 数据库密码（强随机，不要用默认）
DB_PASSWORD=$(openssl rand -base64 32)

# JWT 签名 secret（≥ 16 字符）
JWT_SECRET=$(openssl rand -base64 48)

# LLM provider（选一组配齐）
LLM_API_KEY=sk-your-glm-key
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
LLM_MODEL=glm-4-flash
```

**可选**：
```bash
TAVILY_API_KEY=tvly-...   # 不填则 search_web 降级返回空
```

**强烈建议**：
- 用 `openssl rand` 生成密码 / JWT secret，不要用模板默认值
- `.env.production` 文件权限设 600：`chmod 600 .env.production`

### 6.6 Step 5 — 一键部署

```bash
./scripts/deploy-vps.sh
```

脚本会：
1. 校验 Docker 安装
2. 校验 `.env.production` 关键字段已填（不能是模板默认值）
3. 构建 api + web 镜像（首次 5-10 分钟，看 ECS 性能 + 网络）
4. `docker compose up -d` 启栈
5. 自动 `ollama pull bge-m3`（约 600MB，1-3 分钟）
6. 等 API health endpoint 返回 200
7. 打印验证步骤

### 6.7 Step 6 — 等 Caddy 申请证书

首次启动 Caddy 需要约 30 秒申请 Let's Encrypt 证书：

```bash
docker compose -f docker-compose.prod.yml logs -f caddy | grep -E "certificate|error"
# 看到 "certificate obtained successfully" 即成功
# Ctrl+C 退出 follow
```

**如果一直 retry**：
- 检查 DNS 是否已解析到 ECS IP（`dig $DOMAIN`）
- 检查安全组 80/443 是否开
- ACME_EMAIL 是否合法格式

### 6.8 Step 7 — 浏览器访问

```bash
# 本地 macOS：
open https://idea-maker.example.com/
open https://api.idea-maker.example.com/health

# 服务器内验证：
curl -sk https://idea-maker.example.com/ | head -5
curl -sk https://api.idea-maker.example.com/health
# 应返回：{"status":"ok","service":"@harness/api","timestamp":"..."}
```

---

## 7. 验收清单

部署完成后逐项核对：

### 7.1 服务层
- [ ] `docker compose -f docker-compose.prod.yml ps` 5 个服务全 `running` 或 `healthy`
- [ ] Caddy 日志含 `certificate obtained successfully`
- [ ] Postgres 健康（`pg_isready` 通过）
- [ ] Ollama 列表含 `bge-m3`（`docker compose exec ollama ollama list`）

### 7.2 网络层
- [ ] `curl -sI https://${DOMAIN}/` 返回 200 / 307（重定向）
- [ ] `curl -sI https://api.${DOMAIN}/health` 返回 200 + `Content-Type: application/json`
- [ ] HTTPS 证书有效（浏览器锁标识绿色）
- [ ] 公网 `nmap` 仅看到 80/443 开放（postgres 5432 / ollama 11434 不暴露）

### 7.3 功能层（17 步 e2e smoke）
```bash
API_BASE_URL=https://api.${DOMAIN} node scripts/smoke.mjs
```
- [ ] 17/17 全过
- [ ] 步骤 12 `POST /agent/run` 在 < 5s 返回 runId（防 #10 阻塞 bug 复发）
- [ ] 步骤 16 distill 蒸馏出 ≥ 1 条偏好

### 7.4 浏览器层（手测）
- [ ] 注册新账号 → 创建项目 → 上传文档 → 等 ingestion 完成
- [ ] Chat 页 Agent 模式发消息 → AgentTracePanel 实时显示 step（不卡"启动中"）
- [ ] 看 trace 时间轴含 reasoning / tool_call / tool_result 多种 step
- [ ] /eval 页 → 「立即运行 eval」→ 60s 内完成 → 列表出现新 run
- [ ] Settings → AI 偏好 Tab → 显示「上次自动学习于」时间

### 7.5 安全层
- [ ] `.env.production` 文件权限 600（`ls -la .env.production`）
- [ ] `nmap ecs-ip` 仅 22 / 80 / 443 开放
- [ ] 公网访问 `https://ecs-ip:5432` 失败（Postgres 未暴露）
- [ ] 未经认证调 `/projects` 返回 401

---

## 8. 安全考量

### 8.1 已做
- ✅ 服务最小暴露面：postgres / ollama / api / web 不暴露主机端口
- ✅ Caddy 自动 HTTPS + HSTS（Caddy 默认开）
- ✅ JWT secret ≥ 16 字符强制（auth.service.ts 校验）
- ✅ CORS 白名单：仅生产域名
- ✅ 容器内非 root user 跑应用（api / web Dockerfile）
- ✅ BYOK：API key 通过 env 注入，不进代码 / git

### 8.2 待加固（如真要上生产）
- [ ] **fail2ban** 防 SSH 暴力破解
- [ ] **UFW** 防火墙双层防御（默认 deny incoming，仅放 22/80/443）
- [ ] **JWT 短期 + refresh token** 机制（当前 1h 一直用）
- [ ] **CSP** 头（Content Security Policy）
- [ ] **rate limit**（Caddy 加 `rate_limit` 模块或后端加 throttle）
- [ ] **Encrypted API Key**：当前 project_settings.encrypted_api_key 是明文（TODO 注释里写了 Week 5 接 AES-256，未完成）
- [ ] **审计日志**：谁改了什么 settings / memory
- [ ] **2FA** 登录

### 8.3 密钥管理
- 当前：`.env.production` 文件（chmod 600）
- 升级路径：阿里云 KMS / Hashicorp Vault / Doppler

### 8.4 数据隔离
- 当前：单 Postgres 用户，user-level RBAC
- 升级路径：workspace 多租户（feat-013.2 待办）

---

## 9. 监控与日志

### 9.1 日志策略

| 类型 | 当前 | 升级路径 |
|---|---|---|
| 应用日志 | `docker compose logs`（stdout/stderr）| 接 Loki / Elasticsearch |
| Caddy access log | stdout | 同上 |
| Postgres slow query | 默认未开 | `log_min_duration_statement = 1000` |
| Agent trace | 入 `agent_steps` 表（这是项目的 transparency 卖点）| 当前已可用 |
| Eval 报告 | 入 `eval_runs` + UI 趋势图 | 可加 Slack/邮件通知 |

### 9.2 健康检查

| 端点 | 监控频率 | 失败动作 |
|---|---|---|
| `https://api.${DOMAIN}/health` | 30s（docker healthcheck）| restart api container |
| `https://${DOMAIN}/` | 30s | restart web container |
| Caddy 自身 | docker restart policy `unless-stopped` | 自动重启 |

### 9.3 外部监控（升级路径）

```
- UptimeRobot / Cronitor（免费，5 分钟一次）
  ↓ 探测 https://api.${DOMAIN}/health
  ↓ down 时邮件 / 微信通知
```

### 9.4 资源监控

```bash
# 容器资源
docker stats --no-stream

# 磁盘
df -h
docker system df

# 内存压力
free -h
```

升级路径：装 `node_exporter` + Prometheus + Grafana 三件套（但简历项目可不做）。

---

## 10. 备份与恢复

### 10.1 备份策略

| 数据 | 频率 | 保留 | 方法 |
|---|---|---|---|
| Postgres 全量 | 每日凌晨 3:00 | 7 天 | `pg_dump` 写到本地 / OSS |
| Ollama 模型 | 一次性 | 永久 | 在 image / volume 里 |
| Caddy 证书 | 每次部署 | 永久 | 在 `caddy_data` volume |
| `.env.production` | 手动改时 | 永久 | 加密备份到密码管理器 |
| 上传文档（`apps/api/data/uploads`）| 每周 | 4 周 | 同 Postgres |

### 10.2 备份脚本（建议加 cron）

```bash
# /usr/local/bin/backup-idea-maker.sh
#!/usr/bin/env bash
set -e
BACKUP_DIR=/var/backups/idea-maker
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M%S)
cd /opt/idea-maker

# Postgres 全量
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres rag | gzip > "$BACKUP_DIR/pg-$TS.sql.gz"

# 上传文件
docker compose -f docker-compose.prod.yml exec -T api \
  tar -czf - -C /app/data uploads 2>/dev/null > "$BACKUP_DIR/uploads-$TS.tar.gz" || true

# 删除 7 天前
find "$BACKUP_DIR" -mtime +7 -delete
```

加 cron：
```bash
sudo crontab -e
# 加：
0 3 * * * /usr/local/bin/backup-idea-maker.sh
```

### 10.3 异地备份（升级路径）

将 `$BACKUP_DIR` 同步到阿里云 OSS：
```bash
ossutil cp -r "$BACKUP_DIR" oss://your-bucket/idea-maker-backups/
```

### 10.4 恢复演练

至少**每月跑一次**：

```bash
# 1. 恢复到测试库
gunzip -c /var/backups/idea-maker/pg-20260602-030001.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U postgres -d rag_restore_test

# 2. 验证数据完整性
docker compose exec postgres psql -U postgres -d rag_restore_test \
  -c "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM projects; SELECT COUNT(*) FROM agent_runs;"
```

> ⚠️ 没演练过的备份等于没备份。

---

## 11. 回滚预案

### 11.1 触发条件
- 代码 push 后 smoke 不过
- 用户报告新 bug
- 部署后健康检查持续失败

### 11.2 5 分钟回滚步骤

```bash
cd /opt/idea-maker

# 1. 回到上一个 commit
git log --oneline -5             # 找到上一个稳定 commit
git checkout <stable-commit>

# 2. 重新部署（脚本会重新 build + up）
./scripts/deploy-vps.sh

# 3. 验证
curl -sf https://api.${DOMAIN}/health
```

### 11.3 数据库 schema 不兼容情况

如果回滚版本对应的 DDL 比当前少，则**不能直接回滚** Postgres 数据：

```bash
# 1. 备份当前数据
docker compose exec -T postgres pg_dump -U postgres rag | gzip > /tmp/rollback-$(date +%s).sql.gz

# 2. 创建新空库
docker compose exec postgres psql -U postgres -c "CREATE DATABASE rag_rollback;"

# 3. 回滚代码，新库会被 initSchema 建好旧版表
# 4. 从备份恢复必要数据到新库（手动 SELECT INSERT，因为 schema 不同）
```

> 实际项目里：避免**破坏性 DDL 变更**（DROP COLUMN / ALTER TYPE）。我们的 schema.ts 全部用 `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`，天然兼容。

### 11.4 快照回滚（推荐 — 阿里云 ECS 自带）

最稳妥：每次部署前先打 ECS 快照。

```bash
# 阿里云 CLI（如果装了）
aliyun ecs CreateSnapshot --InstanceId i-xxx --DiskId d-xxx \
  --SnapshotName "before-deploy-$(date +%Y%m%d-%H%M%S)"
```

回滚：阿里云控制台 → ECS → 实例 → 快照 → 回滚磁盘。

---

## 12. 性能与容量规划

### 12.1 单次 agent run 资源消耗

| 资源 | 消耗 | 备注 |
|---|---|---|
| LLM API token | ~6000 input + 1500 output | 6 步 ReAct |
| LLM API 调用 | 3-6 次 | reasoning + tool 调用 |
| Embedding 调用 | 0-3 次 | search_kb 触发 |
| Postgres 查询 | 5-20 次 | tool 内部查询 + agent_steps 入库 |
| 内存峰值（ollama） | ~600MB | bge-m3 加载 |
| 内存峰值（api） | ~300MB | ai-sdk + ReAct 上下文 |
| 时间（GLM-4-flash） | 7-10 秒 | LLM 是主要瓶颈 |

### 12.2 并发能力

| ECS 配置 | 同时 agent run 上限 | 备注 |
|---|---|---|
| 1C / 2GB | 1-2 | 1GB 系统 + 600MB ollama + 200MB pg + 200MB api 紧张 |
| 2C / 4GB | 3-5 | 富余 |
| 2C / 8GB | 8-15 | 可以正经做小规模演示 |

### 12.3 扩容策略

| 瓶颈 | 解决 |
|---|---|
| LLM 调用慢 | 换更快 model（如 deepseek-chat 比 glm-4-flash 通常快 30%）|
| Embedding 慢 | 把 ollama 换成云端 embedding-3（注意 dim 兼容）|
| Postgres 慢 | 看 `EXPLAIN ANALYZE` 加索引；feat-013.4 Drizzle 迁移可同步加 |
| ollama OOM | 减小 embedding 模型 / 关 ollama 用云端 |
| 网络带宽 | 升级 ECS 带宽 |
| 单机不够 | 拆服务到多 VPS（api 一台，pg+ollama 一台）|

---

## 13. 成本预算

### 13.1 月度（demo 用量）

| 项 | 金额 | 备注 |
|---|---|---|
| 阿里云 ECS 2C/4GB 包年 | ~80 元/月 | 拉满优惠 |
| 阿里云 ECS 2C/4GB 按量 | ~150 元/月 | 不开特价 |
| 域名 .com | ~5 元/月 | 50 元/年摊销 |
| LLM 调用（100 次/月）| < 1 元 | GLM-4-flash |
| OSS 备份（7 天 × 100MB）| < 1 元 | |
| **合计（包年）**| **~85 元/月** | |
| **合计（按量）**| **~155 元/月** | |

### 13.2 学生 / 个人开发优化

- 阿里云轻量服务器 1C/2GB：~25 元/月
- 抢学生机 / 个人开发者活动：可能更便宜
- LLM 用 DeepSeek（比 GLM 还便宜约 30%）

### 13.3 不要做的省钱举动

- ❌ 跑在自家 NAS / 树莓派：公网 IP 不稳定 + 上传带宽差 + 面试不能用
- ❌ Render / Railway 免费 tier：冷启动 30s，HR 点开第一眼是 loading
- ❌ Free LLM tier（Groq 等）：rate limit 紧 + 不稳定

---

## 14. 故障预案与排错手册

### 14.1 故障分级

| 等级 | 现象 | 响应时间 | 谁处理 |
|---|---|---|---|
| P0 | 网站打不开 | 5 分钟 | 你（看是不是证书 / DNS）|
| P1 | 能开但 agent 跑不通 | 30 分钟 | 你（看 LLM provider）|
| P2 | 部分功能异常（如 search_web）| 当天 | 你 |
| P3 | UI 小 bug | 当周 | 你 |

### 14.2 常见故障 → 诊断 → 修复

#### 故障 A：访问域名 502
```
诊断：
  docker compose ps                 # 看是不是 web container 挂了
  docker compose logs web | tail    # 看启动错误

常见原因：
  1. NEXT_PUBLIC_API_URL 构建时没设对 → 重 build 镜像
  2. web container OOM → docker stats 看；调小 Node old space 或加内存
  3. standalone server.js 路径错 → Dockerfile 的 CMD 路径

修复：
  docker compose -f docker-compose.prod.yml up -d --force-recreate web
```

#### 故障 B：证书申请反复失败
```
诊断：
  docker compose logs caddy | grep -i "error\|acme"
  dig $DOMAIN                       # DNS 是否对
  nmap -p 80,443 ecs-ip            # 端口是否开

常见原因：
  1. DNS 还没生效（TTL 10 分钟内可能没传遍全球）
  2. 80 端口被占用（其他 Nginx？sudo lsof -i:80）
  3. Let's Encrypt rate limit（同一域名 1 周 5 次申请）

修复：
  - 等 DNS 生效
  - 停掉占 80 的进程
  - rate limit：等一周或用 staging server（修改 Caddyfile）
```

#### 故障 C：Agent run 卡住「启动中」
```
诊断：
  浏览器 DevTools Network 看 /agent/run 是否秒返回（< 200ms）
  看 /stream 是否在挂着
  
常见原因：
  1. SSE 被中间反代 buffer（云厂商 SLB 之类前置代理）
  2. Caddyfile flush_interval 没 -1
  3. feat-300.6 #10 阻塞 bug 复发（不应该，但万一）

修复：
  - 确认无 SLB 前置代理
  - Caddyfile 检查 flush_interval -1 在 api.${DOMAIN} 块下
  - 看 api 日志 docker compose logs api | grep "POST.*agent/run"
```

#### 故障 D：search_kb 返回 embedding 错误
```
诊断：
  docker compose exec ollama ollama list  # 看是否有 bge-m3
  
修复：
  docker compose exec ollama ollama pull bge-m3
  docker compose restart api
```

#### 故障 E：数据库满
```
诊断：
  docker system df
  docker compose exec postgres df -h
  docker compose exec postgres psql -U postgres -d rag -c "
    SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(quote_ident(tablename)::text)) AS size
    FROM pg_tables WHERE schemaname='public' ORDER BY pg_total_relation_size(quote_ident(tablename)::text) DESC;"

常见原因：
  1. agent_steps 增长太快（每 run 几十行 + JSONB）
  2. spilled blob 没清理

修复：
  - 跑清理 SQL：删除 90 天前的 agent_runs（CASCADE 删 agent_steps）
  - 删 data/agent-spills 旧文件
```

### 14.3 必备排错命令速查

```bash
# 看所有服务状态
docker compose -f docker-compose.prod.yml ps

# 看某服务日志
docker compose -f docker-compose.prod.yml logs -f api --tail=200

# 进容器调试
docker compose -f docker-compose.prod.yml exec api sh

# 重启某服务
docker compose -f docker-compose.prod.yml restart api

# 强制重建（代码改了之后）
docker compose -f docker-compose.prod.yml up -d --build api

# 进 Postgres
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres rag

# 看 Caddy 申请的证书
docker compose -f docker-compose.prod.yml exec caddy ls /data/caddy/certificates
```

---

## 15. 升级路径

按 ROI 排序，做不做都行：

### 15.1 短期（1 周内可加）

| # | 改进 | 收益 | 工期 |
|---|---|---|---|
| 1 | **CI/CD**：GitHub Actions 自动 ssh 部署 | git push 自动上线 | 1 天 |
| 2 | **加 cron 备份脚本** | 自动每日 pg_dump | 2 小时 |
| 3 | **UptimeRobot 监控** | 宕机告警 | 30 分钟 |
| 4 | **优化 API 镜像 1.13GB → 500MB** | 部署快 + 拉镜像快 | 半天 |

### 15.2 中期（1 个月）

| # | 改进 | 收益 | 工期 |
|---|---|---|---|
| 5 | **feat-013.4 Drizzle ORM 迁移** | 类型安全 + migration 工具链 | 3 天 |
| 6 | **feat-013.3 BYOK key 加密**（AES-256）| 安全合规 | 1 天 |
| 7 | **feat-013.2 workspace 多租户** | 给同事 / 朋友也用 | 1 周 |

### 15.3 长期（生产化）

| # | 改进 | 收益 | 工期 |
|---|---|---|---|
| 8 | **Prometheus + Grafana** | 资源监控仪表盘 | 3 天 |
| 9 | **CDN 加速**（阿里云 CDN）| 国内访问加速 | 半天 |
| 10 | **k8s 迁移**（阿里云 ACK）| 真正的弹性扩容 + 自动 failover | 1 周 |

---

## 16. 简历讲故事的角度

如果面试官问「**你怎么把它部署上线的**」，3 分钟讲清这些点：

### 答案模板

> **「我做的是全栈单 ECS docker-compose 部署，5 个 container 一键起栈。**
>
> 设计上做了 4 个**有意识的取舍**：
>
> 1. **单 VPS vs 多平台**：选单 VPS 因为我已有阿里云机器（边际成本零）+ ollama 本地 embedding 不依赖外部 API 额度。代价是没 CDN 加速，但简历项目国内访问够用。
>
> 2. **Caddy vs Nginx**：Caddy 自动 Let's Encrypt + Caddyfile 30 行 vs Nginx 100+ 行。SSL 续期零运维。
>
> 3. **Next.js standalone 输出**：镜像 92MB vs 全量 1GB+，部署快 10 倍。
>
> 4. **`.dockerignore` 严格收口**：上下文从 1GB → 50MB，build 速度提升明显。
>
> **安全上**：postgres / ollama / api / web 不暴露主机端口，只有 Caddy 80/443 暴露。容器内非 root user 跑应用。
>
> **可观测**：5 个服务都配了 healthcheck，docker compose 启动依赖关系靠 condition: service_healthy。
>
> **可回滚**：5 分钟 `git checkout <stable> && ./deploy-vps.sh`。生产数据库用 schema IF NOT EXISTS 兼容向后回滚。
>
> 整个方案在 docs/DEPLOY-PLAN.md 里有完整决策记录、安全清单、备份策略、故障预案——简历项目我把它当真生产系统在做。」

### 高级延伸（如果对方继续问）

| 对方问 | 你的答 |
|---|---|
| 为啥不用 K8s？ | 「5 个容器单机够用，K8s 学习曲线 + 资源开销不值。生产化才考虑（feat-013.5+）」 |
| 怎么做高可用？ | 「当前单 VPS 单点。生产化方案：API 多副本 + 外部 RDS + 阿里云 SLB」 |
| LLM API 限流怎么办？ | 「ai-sdk 自带 retry；CostTracker 在 LLM 之前用 budget 闸门主动限流；超 budget 走 fallback 拼已搜到 chunks」 |
| 万一 ollama OOM？ | 「换云端 embedding-3，1024 维与 DDL 兼容只改 EMBEDDING_BASE_URL」 |
| 怎么知道部署有没有挂？ | 「Caddy + container healthcheck 自动重启 + UptimeRobot 外部探测」 |

---

## 附录 A：相关文件索引

| 文件 | 用途 |
|---|---|
| [`docs/DEPLOY.md`](DEPLOY.md) | 快速参考（step-by-step 命令清单）|
| [`docs/DEPLOY-flyio-legacy.md`](DEPLOY-flyio-legacy.md) | 旧 Fly.io 方案归档 |
| [`docker-compose.prod.yml`](../docker-compose.prod.yml) | 服务编排 |
| [`Caddyfile`](../Caddyfile) | 反向代理 + SSL 配置 |
| [`apps/api/Dockerfile`](../apps/api/Dockerfile) | API 镜像 |
| [`apps/web/Dockerfile`](../apps/web/Dockerfile) | Web 镜像 |
| [`.env.production.example`](../.env.production.example) | env 模板 |
| [`scripts/deploy-vps.sh`](../scripts/deploy-vps.sh) | 一键部署脚本 |
| [`scripts/smoke.mjs`](../scripts/smoke.mjs) | 17 步端到端验证 |
| [`feature_list.json`](../feature_list.json) | feat-013.5 的位置在工程化 epic |
