#!/usr/bin/env bash
# scripts/setup-worktrees.sh — 一次性初始化 3-worktree 协作环境
# 用法：bash scripts/setup-worktrees.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "🔧 setup-worktrees.sh: 在 $REPO_ROOT 初始化 worktree 环境"

# ─── Step 1: git init（如果尚未初始化）───────────────────────────
if [ ! -d ".git" ]; then
  echo "📦 仓库未初始化，执行 git init..."
  git init
  git config init.defaultBranch main 2>/dev/null || true

  # 必须有至少一个 commit 才能建分支 / worktree
  if [ ! -f ".gitignore" ]; then
    echo "⚠️  未找到 .gitignore，请先创建（应已包含在本批次产物中）"
    exit 1
  fi

  git add .gitignore AGENTS.md CLAUDE.md README.md docs scripts 2>/dev/null || true
  git -c user.email="setup@local" -c user.name="setup" commit -m "chore: 初始化仓库与协作脚本" || true

  # 确保在 main 分支
  current_branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
  if [ "$current_branch" != "main" ]; then
    git branch -M main
  fi
else
  echo "✅ git 仓库已存在"
fi

# ─── Step 2: 创建 2 个 feat 分支（如果尚未存在）───────────────
for branch in feat/admin feat/web; do
  if git rev-parse --verify "$branch" >/dev/null 2>&1; then
    echo "✅ 分支 $branch 已存在"
  else
    git branch "$branch" main
    echo "🌿 创建分支 $branch"
  fi
done

# ─── Step 3: 创建 worktree ───────────────────────────────────
mkdir -p worktrees

create_worktree() {
  local name=$1
  local branch=$2
  local path="worktrees/$name"
  if [ -d "$path/.git" ] || [ -f "$path/.git" ]; then
    echo "✅ worktree $path 已存在"
  else
    git worktree add "$path" "$branch"
    echo "🌳 创建 worktree $path → $branch"
  fi
}

create_worktree "admin" "feat/admin"
create_worktree "web" "feat/web"

# ─── Step 4: 拷贝 .claude-role.md 到各 worktree ────────────────
copy_role() {
  local name=$1
  local src="scripts/role-templates/role-$name.md"
  local dst="worktrees/$name/.claude-role.md"
  if [ ! -f "$src" ]; then
    echo "❌ 角色模板缺失：$src"
    exit 1
  fi
  cp "$src" "$dst"
  echo "📄 写入 $dst"
}

copy_role "admin"
copy_role "web"

# 主目录（main）= 总控 + 合并枢纽（双重身份），放对应角色文件
if [ -f "scripts/role-templates/role-main.md" ]; then
  cp "scripts/role-templates/role-main.md" ".claude-role.md"
  echo "📄 写入 ./.claude-role.md（主目录 = 总控 + 合并枢纽）"
fi

# ─── Step 5: .env symlink（如有 .env 实文件）──────────────────
if [ -f ".env" ]; then
  for name in admin web; do
    target="worktrees/$name/.env"
    if [ ! -e "$target" ]; then
      ln -s "../../.env" "$target"
      echo "🔗 创建 symlink $target → ../../.env"
    fi
  done
else
  echo "ℹ️  未找到根目录 .env，跳过 symlink（之后创建 .env 后再次执行本脚本即可）"
fi

# ─── Step 6: 自检 ────────────────────────────────────────────
echo ""
echo "🧪 自检："
git worktree list
echo ""
echo "✅ 初始化完成。下一步："
echo "   终端 1（总控 + 合并）: cd $(basename "$REPO_ROOT") && claude"
echo "   终端 2（运营端 B）   : cd worktrees/admin && claude"
echo "   终端 3（学生端 C）   : cd worktrees/web   && claude"
echo "   合并 feat → main    : bash scripts/merge-to-main.sh feat/admin|feat/web"
