#!/usr/bin/env bash
# scripts/merge-to-main.sh — 把 feat/admin 或 feat/web 合并回 main
# 用法（在主目录执行，不要在 worktrees/ 内）：
#   bash scripts/merge-to-main.sh feat/admin
#   bash scripts/merge-to-main.sh feat/web

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "用法：bash scripts/merge-to-main.sh <feat/admin|feat/web>"
  exit 1
fi

FEATURE_BRANCH=$1

case "$FEATURE_BRANCH" in
  feat/admin|feat/web) ;;
  *)
    echo "❌ 仅支持 feat/admin 或 feat/web，传入了 $FEATURE_BRANCH"
    exit 1 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ─── 必须在主目录 worktree（branch=main）执行 ────────────────
CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "❌ 本脚本必须在主目录（main 分支）执行，当前分支：$CURRENT_BRANCH"
  echo "   请 cd 到 $REPO_ROOT 后再次运行"
  exit 1
fi

# ─── 工作区必须干净 ──────────────────────────────────────────
if ! git diff-index --quiet HEAD --; then
  echo "❌ 主目录工作区有未提交修改，请先处理"
  git status --short
  exit 1
fi

# ─── 执行 merge --no-ff ──────────────────────────────────────
echo "🔀 git merge --no-ff $FEATURE_BRANCH → main"
if ! git merge --no-ff "$FEATURE_BRANCH" -m "merge: $FEATURE_BRANCH → main"; then
  echo ""
  echo "⚠️  merge 冲突。选项："
  echo "   1) git merge --abort           # 放弃，请总控（A）介入仲裁"
  echo "   2) 手动解决冲突 → git add → git commit"
  exit 2
fi

# ─── 重新生成 lockfile（B/C 没提交 lockfile，这里统一刷新）──
if command -v pnpm >/dev/null 2>&1 && [ -f "pnpm-workspace.yaml" ]; then
  echo "📦 重新生成 pnpm-lock.yaml..."
  pnpm install
  if ! git diff --quiet pnpm-lock.yaml 2>/dev/null; then
    git add pnpm-lock.yaml
    git commit -m "chore: 更新 pnpm-lock.yaml（合并 $FEATURE_BRANCH 后）"
    echo "✅ lockfile 已更新并提交"
  else
    echo "ℹ️  lockfile 无变化"
  fi
fi

echo ""
echo "✅ $FEATURE_BRANCH 已合入 main"
echo "   下一步：通知对端 worktree（B/C）执行 \`bash ../../scripts/sync-from-main.sh\` 拉取最新 main"
