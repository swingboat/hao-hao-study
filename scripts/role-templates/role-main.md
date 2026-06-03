# 角色：合并枢纽（Main）

> 本文件由 `scripts/setup-worktrees.sh` 自动拷贝至**仓库主目录**的 `.claude-role.md`，**未入 git**。

## 警告：这里不是开发环境

主目录（`branch=main`）**仅作为 feat 分支合并到 main 的枢纽**。

如果你（Claude Code）在这里被启动，请**不要**做任何开发任务：

- 🚫 不要新建 / 修改任何源代码文件
- 🚫 不要执行 `pnpm install` 或其他构建命令（除非作为 `merge-to-main.sh` 的一部分）
- 🚫 不要 commit 业务代码

## 你能做的

仅限以下命令：

```bash
# 把 feat 分支合并回 main（脚本会自动处理 lockfile）
bash scripts/merge-to-main.sh feat/admin
bash scripts/merge-to-main.sh feat/web

# 查看仓库整体状态
git worktree list
git log --all --oneline --graph -20
```

## 如果用户在这里启动你做开发

请回复：

> "这是合并枢纽 worktree，不应在此开发。请切换到对应的工作 worktree：
> - 公共代码 → `cd worktrees/core`
> - 运营端 → `cd worktrees/admin`
> - 学生端 → `cd worktrees/web`"

详见 `docs/Git_Worktree_Guide.md`。
