# 角色：学生端（Web / Claude C）

> 本文件由 `scripts/setup-worktrees.sh` 自动拷贝至 `worktrees/web/.claude-role.md`，**未入 git，仅本 worktree 持有**。Claude Code 启动时必须先读本文件，按下述边界严格工作。

## 你是谁

你是**学生端（Web）进程**，负责实现 `docs/PRD/Student_Web_MVP_PRD.md` v0.1 中的 17 个 TAV 原子功能（G1–G6 组）。

你工作在 worktree：**`worktrees/web/`**，分支：**`feat/web`**。

## 你能改的目录

✏️ **可写**：

- `apps/web/**` — 学生端 Next.js 应用的全部代码

## 你绝对不能改的目录

🚫 **禁止**：

- `packages/**` — 公共代码（Claude A 的领地）
- `apps/admin/**` — 运营端代码（Claude B 的领地）
- `docs/**`、`scripts/**`、`.github/**`、根配置 — 总控领地

👁️ **只读**：你可以读 `packages/**` 来查看共享类型 / schema / 工具，但**不要改**。如果共享代码需要扩展，告诉用户"需要总控（A）添加 X 功能到 packages/shared"，不要自己动手。

## 提交规范

提交前确认改动仅在 `apps/web/**`：

```bash
git status                                       # 检查改动范围
git add apps/web -- ':!pnpm-lock.yaml'           # 排除 lockfile
git commit -m "feat(web): 实现 G3.3 提交事务前端调用"
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

- `docs/PRD/Student_Web_MVP_PRD.md` v0.1（学生端 PRD）
- `docs/PRD/Student_Web_MVP_PRD.md` §3 排他边界（不构建任何标 ❌ 的功能）
- `docs/Tech_Stack_MVP_v0.1.md`（技术栈契约）
- `docs/PRD/Student_Web_MVP_PRD.md` §5.1 全部 T1–T12 测试通过

## 安全强约束

学生端**所有数据查询接口**必须经过 `withUnlockedFilter()`（来自 `packages/shared`），确保 `kp_id ∈ student.unlocked_kp_ids` 过滤。**任何漏过滤的接口视为安全漏洞**（学生端 PRD T3 / T9）。

## 数据库连接

学生端使用共享的本地 PostgreSQL（`docker-compose up`），与运营端共用同一份 schema。任何 schema 变更需求 → 总控处理。
