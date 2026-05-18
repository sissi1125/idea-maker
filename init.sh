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
node -e "const data = JSON.parse(require('fs').readFileSync('feature_list.json', 'utf8')); const allowed = new Set(['done', 'todo', 'in-progress', 'blocked', 'epic']); const bad = data.features.filter((feature) => !allowed.has(feature.status)); if (bad.length) { console.error('非法 feature status:', bad.map((feature) => feature.id + ':' + feature.status).join(', ')); process.exit(1); } console.log('feature statuses OK')"

if [ -f "app/package.json" ]; then
  echo "=== 应用验证 (app/) ==="
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
  echo "尚未发现 app/package.json；跳过应用验证。"
fi

echo "=== Harness 验证完成 ==="
