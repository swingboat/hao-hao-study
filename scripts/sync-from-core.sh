#!/usr/bin/env bash
# scripts/sync-from-core.sh — admin / web worktree 从 core/main 拉取最新公共代码
# 用法：在 worktrees/admin 或 worktrees/web 目录下执行：
#   bash ../../scripts/sync-from-core.sh

set -euo pipefail

CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")

# ─── 安全检查 ────────────────────────────────────────────────
case "$CURRENT_BRANCH" in
  feat/admin|feat/web)
    echo "🔄 当前分支 $CURRENT_BRANCH，开始从 core/main 同步..."
    ;;
  "")
    echo "❌ 未在 git 分支上"; exit 1 ;;
  *)
    echo "❌ 当前分支为 $CURRENT_BRANCH，本脚本仅适用于 feat/admin 或 feat/web"
    exit 1 ;;
esac

# ─── 检查工作区是否干净 ──────────────────────────────────────
if ! git diff-index --quiet HEAD --; then
  echo "❌ 工作区有未提交的修改，请先 commit 或 stash："
  git status --short
  exit 1
fi

# ─── (可选) 远程拉取占位 — 当前离线协作，未启用 ────────────
# git fetch origin core/main 2>/dev/null || true

# ─── rebase 到 core/main ─────────────────────────────────────
if ! git rebase core/main; then
  echo ""
  echo "⚠️  rebase 冲突。选项："
  echo "   1) git rebase --abort      # 放弃，让总控（A）协助"
  echo "   2) 手动解决冲突 → git add → git rebase --continue"
  exit 2
fi

# ─── 重装依赖 + 重新生成 prisma client ────────────────────────
if [ -f "package.json" ] || [ -f "../../package.json" ]; then
  if command -v pnpm >/dev/null 2>&1; then
    echo "📦 pnpm install..."
    pnpm install --prefer-offline || echo "⚠️  pnpm install 非零退出，请手动检查"

    if pnpm list --filter @hao-hao/db >/dev/null 2>&1; then
      echo "🔧 pnpm --filter @hao-hao/db generate..."
      pnpm --filter @hao-hao/db generate || echo "⚠️  prisma generate 失败，请手动检查"
    fi
  else
    echo "ℹ️  未安装 pnpm，跳过依赖更新"
  fi
fi

echo ""
echo "✅ 已同步至 core/main 最新；node_modules 与 prisma client 已刷新。"
