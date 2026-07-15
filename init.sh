#!/bin/bash
set -euo pipefail

echo "=== Harness 文件检查 ==="

required_files=(
  "AGENTS.md"
  "README.md"
  "docs/PRODUCT.md"
  "docs/ARCHITECTURE.md"
  "docs/API_CONTRACTS.md"
  "docs/RAG_PIPELINE_PLAYGROUND.md"
  "docs/VERIFICATION.md"
  "docs/ORCHESTRATION.md"
  "feature_list.json"
  "progress.md"
  "session-handoff.md"
)

for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "缺少必需文件: $file"
    exit 1
  fi
done

echo "=== JSON 校验 ==="
node -e "JSON.parse(require('fs').readFileSync('feature_list.json', 'utf8')); console.log('feature_list.json OK')"

echo "=== Feature 状态校验 ==="
node -e "const data = JSON.parse(require('fs').readFileSync('feature_list.json', 'utf8')); const allowed = new Set(['done', 'todo', 'in-progress', 'blocked', 'epic', 'superseded']); const bad = data.features.filter((feature) => !allowed.has(feature.status)); if (bad.length) { console.error('非法 feature status:', bad.map((feature) => feature.id + ':' + feature.status).join(', ')); process.exit(1); } console.log('feature statuses OK')"

echo "=== Harness 一致性校验（track / phase / 依赖闭包）==="
node scripts/check-harness.mjs

if [ -f "pnpm-workspace.yaml" ]; then
  echo "=== Monorepo 验证（pnpm workspace）==="
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "未找到 pnpm，请先 'corepack enable' 或全局安装 pnpm"
    exit 1
  fi
  if [ ! -d "node_modules" ] || [ ! -d "apps/web/node_modules" ]; then
    echo "安装依赖（pnpm install）..."
    pnpm install --silent
  fi
  # shared-types 与 rag-core 的 exports 都指向 dist；先生成声明文件，避免干净工作区
  # 在 typecheck/test 时把 workspace 包误判为不存在。
  echo "--- build workspace libraries ---"
  pnpm --filter @harness/shared-types build
  pnpm --filter @harness/rag-core build
  echo "--- workspace typecheck ---"
  pnpm -r typecheck
  echo "--- workspace lint ---"
  pnpm -r lint
elif [ -f "app/package.json" ]; then
  echo "=== 应用验证（app/，pre-monorepo 兼容路径）==="
  cd app
  if [ ! -d "node_modules" ]; then
    echo "安装依赖..."
    npm install --cache /tmp/npm-cache
  fi
  echo "--- typecheck ---"
  npm run typecheck
  echo "--- lint ---"
  npm run lint
  cd ..
else
  echo "尚未发现 pnpm-workspace.yaml 或 app/package.json；跳过应用验证。"
fi

echo "=== session-handoff.md HEAD 一致性检查 ==="
CURRENT_HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo "")
if [ -n "$CURRENT_HEAD" ]; then
  RECORDED_HEAD=$(grep -E "(当前|已提交) HEAD" session-handoff.md | sed 's/.*HEAD：`\([a-f0-9]*\)`.*/\1/' | head -1 || true)
  if [ -z "$RECORDED_HEAD" ]; then
    echo "警告：session-handoff.md 中未找到 HEAD 记录，请检查格式。"
    exit 1
  fi
  # 计算记录的 HEAD 与当前 HEAD 之间的提交数（容差 ≤5 个 commit 视为正常：会话收尾的 fix/docs 提交）
  COMMITS_BEHIND=$(git rev-list --count "${RECORDED_HEAD}..HEAD" 2>/dev/null || echo "999")
  if [ "$COMMITS_BEHIND" -gt 5 ]; then
    echo "文档严重滞后（${COMMITS_BEHIND} 个提交）：记录 ${RECORDED_HEAD}，当前 ${CURRENT_HEAD}"
    echo "请先更新 session-handoff.md 和 progress.md，再继续开发。"
    exit 1
  elif [ "$COMMITS_BEHIND" -gt 0 ]; then
    echo "文档轻微滞后（${COMMITS_BEHIND} 个提交，会话收尾容差内）：$RECORDED_HEAD → $CURRENT_HEAD ✓"
  else
    echo "HEAD 一致：$CURRENT_HEAD ✓"
  fi
fi

echo "=== Harness 验证完成 ==="
