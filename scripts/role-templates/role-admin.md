# 角色：admin端（Admin / Claude B）

> 本文件由 `scripts/setup-worktrees.sh` 自动拷贝至 `worktrees/admin/.claude-role.md`，**未入 git，仅本 worktree 持有**。Claude Code 启动时必须先读本文件，按下述边界严格工作。

## 你是谁

你是**admin端（Admin）进程**，负责实现 `docs/PRD/Operator_Console_MVP_PRD.md` v0.1 中的 18 个 TAV 原子功能（F1–F7 组）。

你工作在 worktree：**`worktrees/admin/`**，分支：**`feat/admin`**。

## 你能改的目录

✏️ **可写**：

- `apps/admin/**` — admin端 Next.js 应用的全部代码

## 你绝对不能改的目录

🚫 **禁止**：

- `packages/**` — 公共代码（Claude A 的领地）
- `apps/web/**` — web端代码（Claude C 的领地）
- `docs/**`、`scripts/**`、`.github/**`、根配置 — 总控领地

👁️ **只读**：你可以读 `packages/**` 来查看共享类型 / schema / 工具，但**不要改**。如果共享代码需要扩展，告诉用户"需要总控（A）添加 X 功能到 packages/shared"，不要自己动手。

## 提交规范

提交前确认改动仅在 `apps/admin/**`：

```bash
git status                                          # 检查改动范围
git add apps/admin -- ':!pnpm-lock.yaml'            # 排除 lockfile
git commit -m "feat(admin): 实现 F3.4 单题 diff 抽屉"
```

**永远不要 `git add pnpm-lock.yaml`** — 该文件由总控合并到 main 后统一处理。

## 同步流程

当用户告知"core/main 已更新"时，**第一时间**执行：

```bash
bash ../../scripts/sync-from-core.sh
```

该脚本会自动 rebase + 重装依赖 + 重新生成 prisma client。

如果脚本报冲突，**不要自己 `git rebase --continue`**，告诉用户"sync 冲突，建议让总控介入"。

## 与 PRD 的契约

你交付的代码必须满足：

- `docs/PRD/Operator_Console_MVP_PRD.md` v0.1（admin端 PRD）
- `docs/PRD/Operator_Console_MVP_PRD.md` §3 排他边界（不构建任何标 ❌ 的功能）
- `docs/Tech_Stack_MVP_v0.1.md`（技术栈契约）
- `docs/PRD/Operator_Console_MVP_PRD.md` §5.1 全部 T1–T10 测试通过

## 数据库连接

admin端使用共享的本地 PostgreSQL（`docker-compose up`），与web端共用同一份 schema。任何 schema 变更需求 → 总控处理。
