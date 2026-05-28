#!/usr/bin/env bash
# docker-entrypoint.sh — 并发启动 API + Web
#
# 用 wait -n 监控两个进程；任一退出即整个容器退出（让 Fly.io 自动重启）。
# 不用 npm 而是直接 node：少一层进程，PID 1 由 dumb-init 接管。

set -euo pipefail

# API（NestJS, port 3001）
node /app/apps/api/dist/main.js &
API_PID=$!

# Next.js standalone（port 3000）
# standalone 模式输出 server.js 在 apps/web/server.js
cd /app/apps/web
PORT=3000 HOSTNAME=0.0.0.0 node server.js &
WEB_PID=$!

echo "API pid=$API_PID  Web pid=$WEB_PID"

# 任一退出就退出整个容器，让 Fly.io / Docker restart 接管
wait -n
EXIT_CODE=$?
echo "Process exited with code $EXIT_CODE, killing the rest"
kill -TERM "$API_PID" "$WEB_PID" 2>/dev/null || true
exit $EXIT_CODE
