# Git Worktree 协作指南 — 3 进程并行开发

> 本文件规定 3 个 Claude Code 进程（**总控 / admin端 / web端**）在同一个 git 仓库下并行工作时的边界、同步协议与日常命令。
>
> | 版本 | 日期 | 说明 |
> |---|---|---|
> | v0.1 | 2026-06-03 | 首次发布；适用于 v0.1 MVP 阶段离线开发（无 remote） |
> | v0.2 | 2026-06-03 | 简化拓扑：去掉 `core/main` 分支，主目录（main）即总控工作区 + 合并枢纽 |

---

## §1 设计原则（一句话）

> **路径所有权 + 单向同步 + 无 remote 也能协作**：每个 worktree 只写自己的目录，main 是公共代码的唯一源头，admin/web 单向从 main 拉取；本地多 worktree 共享同一 `.git/`，物理上不需要远程仓库。

> v0.1 单人 + 3 Claude 进程下，"总控写公共代码"和"合并 feat 分支"是同一个人的事，因此合并为单一 `main` 分支处理，避免双枢纽循环（v0.2 简化）。

---

## §2 Worktree 与分支拓扑

```
hao-hao-study/                       ← 主目录（git 库实体所在 + 总控 A 工作区 + 合并枢纽）
├── .git/                            ← 共享给所有 worktree
├── (主 worktree, branch=main)        ← Claude A 在这里写 packages/、docs/、scripts/、根配置
│                                       同时承担 merge feat → main 的职责
└── worktrees/
    ├── admin/   branch: feat/admin  ← Claude B admin端
    └── web/     branch: feat/web    ← Claude C web端
```

| Worktree | 分支 | 跑哪个 Claude Code | 用途 |
|---|---|---|---|
| 主目录（`./`） | `main` | **Claude A** | 公共代码、配置、文档、脚本、迁移；同时作为合并枢纽 |
| `worktrees/admin/` | `feat/admin` | Claude B | 仅 `apps/admin/**` |
| `worktrees/web/` | `feat/web` | Claude C | 仅 `apps/web/**` |

> ⚠️ 同一个分支不能在多个 worktree 同时 checkout，git 会报 `already checked out`。这是天然的越界保护。

---

## §3 路径所有权矩阵（防冲突的核心）

> 图例：✏️ = 可写、👁️ = 只读、🚫 = 不应访问（即使读也不要依赖）

| 路径 | main (A，主目录) | admin (B) | web (C) |
|---|---|---|---|
| `packages/db/**` | ✏️ | 👁️ | 👁️ |
| `packages/llm/**` | ✏️ | 👁️ | 👁️ |
| `packages/shared/**` | ✏️ | 👁️ | 👁️ |
| `packages/ui/**` | ✏️ | 👁️ | 👁️ |
| `apps/admin/**` | 👁️ | ✏️ | 🚫 |
| `apps/web/**` | 👁️ | 🚫 | ✏️ |
| `docs/**` | ✏️ | 🚫 | 🚫 |
| `scripts/**` | ✏️ | 🚫 | 🚫 |
| `.github/**` | ✏️ | 🚫 | 🚫 |
| 根配置（见 §3.1） | ✏️ | 🚫 | 🚫 |
| 根 `pnpm-lock.yaml` | ✏️（A 写 / 合并后） | 🚫提交 | 🚫提交 |

### §3.1 根配置文件清单（仅 A 可改）

```
package.json
pnpm-workspace.yaml
tsconfig.base.json
biome.json
docker-compose.yml
.env.example
.npmrc
.gitignore
AGENTS.md
CLAUDE.md
README.md
```

> `.env`（实际值文件）通过 symlink 共享，不归任何 worktree 所有，永不入 git。

### §3.2 pnpm-lock.yaml 特殊规则

`pnpm install` 在任何 worktree 都会重写 lockfile —— 这是冲突高发区。规则：

1. **B/C 在 sync 后跑 `pnpm install` 是允许的**（更新本地 node_modules）
2. **B/C 不要 `git add pnpm-lock.yaml`**（让 lockfile 改动留在工作区，不进 commit）
3. **lockfile 的提交统一发生在合并到 main 后**（由 `merge-to-main.sh` 自动重跑 `pnpm install` 并提交）

实操：B/C 的 commit 命令统一加 `--` 排除：

```bash
git add apps/admin -- ':!pnpm-lock.yaml'
```

---

## §4 单向同步协议

```
            ┌─────────────────────┐
            │  main (A，主目录)   │
            └──────────┬──────────┘
                       │ ① A 提交后通知用户
        ┌──────────────┴──────────────┐
        ▼                             ▼
   ② B rebase                    ② C rebase
   feat/admin                    feat/web
        │                             │
        │ ③ B 完成功能                  │ ③ C 完成功能
        └────────────► main ◄─────────┘
                  ④ A 在主目录跑
                  merge-to-main.sh
```

| 步 | 动作 | 谁执行 | 命令 |
|---|---|---|---|
| ① | A 在主目录提交公共变更 | Claude A | `git add ... && git commit -m "..."` |
| ② | B/C 拉取最新 main | 用户在 B/C worktree | `bash ../../scripts/sync-from-main.sh` |
| ③ | B/C 把功能合入 main | 用户在主目录 | `bash scripts/merge-to-main.sh feat/admin` |
| ④ | 合并完成后通知对端再 sync 一次 | A 提示用户 | 在另一 worktree 跑 `sync-from-main.sh` |

`sync-from-main.sh` 会在 rebase 后重新生成 Prisma Client；如果 `DATABASE_URL` 可用，还会执行 `prisma migrate deploy`。这保证 B/C 同步公共 schema 后，共享本地数据库也会应用新增迁移，避免出现 Prisma Client 已包含新 delegate、但 PostgreSQL 尚未建表的运行时错误。

**B 与 C 永远不直接交互**——切断横向冲突。**A 不再需要 rebase 一圈回来**（因为 A 本来就在 main 上）。

---

## §5 角色边界文件 `.claude-role.md`

每个 worktree（含主目录）启动 Claude Code 前，根目录会有一份**未入 git** 的 `.claude-role.md`，由 `setup-worktrees.sh` 脚本从 `scripts/role-templates/` 拷贝生成。

`AGENTS.md` 强约束：所有 Claude Code 启动时**必须先读 `.claude-role.md`**（如存在），按其边界严格工作。

文件位置：

| Worktree | `.claude-role.md` 内容来源 |
|---|---|
| 主目录（A） | `scripts/role-templates/role-main.md` |
| `worktrees/admin/`（B） | `scripts/role-templates/role-admin.md` |
| `worktrees/web/`（C） | `scripts/role-templates/role-web.md` |

---

## §6 一次性初始化

### §6.1 初始化命令

在仓库根目录执行：

```bash
bash scripts/setup-worktrees.sh
```

该脚本会：

1. 若仓库未 `git init`，先初始化 + 首次 commit
2. 确认 `main` 分支存在
3. 创建 2 个 feat 分支：`feat/admin`、`feat/web`
4. 创建 2 个 worktree：`worktrees/admin`、`worktrees/web`
5. 拷贝 `.claude-role.md` 到主目录与每个 worktree
6. 创建 `.env` symlink 链（如果根目录有 `.env` 文件）

### §6.2 拉起 3 个 Claude Code 进程

打开 3 个终端：

```bash
# 终端 1（总控 A，同时承担合并枢纽）
cd /Users/huyin/Swingboat/github/hao-hao-study && claude

# 终端 2（admin端 B）
cd worktrees/admin && claude

# 终端 3（web端 C）
cd worktrees/web && claude
```

每个进程启动时会自动读到当前目录的 `.claude-role.md`，明确知道自己的工作边界。

---

## §7 日常命令清单

### §7.1 A（总控 + 合并枢纽）日常

```bash
# 在主目录

# 改完 packages/* 或 docs/* 后
git add packages docs
git commit -m "feat(db): 添加 PARSE_JOB.cost_estimate 字段"

# B/C 完成 feature 后，在主目录合并
bash scripts/merge-to-main.sh feat/admin
bash scripts/merge-to-main.sh feat/web
```

A **绝不**改 `apps/admin/**` 或 `apps/web/**`，遇到这种需求让用户在 B/C 进程处理。

### §7.2 B（admin端）日常

```bash
cd worktrees/admin

# 收到 A "main 已更新" 通知后
bash ../../scripts/sync-from-main.sh
# 脚本会重新生成 Prisma Client，并在 DATABASE_URL 可用时自动执行 prisma migrate deploy

# 改完 apps/admin/* 后
git add apps/admin -- ':!pnpm-lock.yaml'
git commit -m "feat(admin): 实现 F3.4 单题 diff 抽屉"
```

### §7.3 C（web端）日常

```bash
cd worktrees/web

# 收到 A "main 已更新" 通知后
bash ../../scripts/sync-from-main.sh
# 脚本会重新生成 Prisma Client，并在 DATABASE_URL 可用时自动执行 prisma migrate deploy

# 改完 apps/web/* 后
git add apps/web -- ':!pnpm-lock.yaml'
git commit -m "feat(web): 实现 G3.3 提交事务前端调用"
```

### §7.4 A 合并 feat 分支（在主目录）

当 B 或 C 完成一个独立功能要合到 `main`：

```bash
# 在主目录执行（不在 worktrees/ 内）
bash scripts/merge-to-main.sh feat/admin     # 或 feat/web
```

该脚本：
1. 在主目录所在的 main worktree 上执行 `git merge --no-ff feat/admin`
2. 重新 `pnpm install` 解决 lockfile
3. 自动 commit lockfile
4. 提示对端 worktree 再跑一次 `sync-from-main.sh`

---

## §8 冲突预案

### §8.1 rebase 时遇到冲突

`sync-from-main.sh` 失败时不要硬抢。退出脚本，让用户决定：

```bash
# 检查冲突文件
git status

# 选项 1：放弃 rebase，让 A 协助
git rebase --abort

# 选项 2：手动解决（仅当冲突文件确实是 B/C 自己边界内的）
# 编辑文件 → git add → git rebase --continue
```

### §8.2 合并到 main 时冲突

`merge-to-main.sh` 失败时同样退出，由用户判断：

```bash
git merge --abort
# 通常意味着 B/C 都改了根配置（违反所有权矩阵），让 A 介入仲裁
```

### §8.3 误改了不属于自己的目录

立即在 worktree 中：

```bash
git restore --source=HEAD -- packages/   # 撤销 packages 改动（admin worktree 示例）
```

并向用户报告"误碰了 packages，已撤销，请告知 A 处理"。

---

## §9 验收清单（setup 完成后自检）

- [ ] `git worktree list` 显示 3 个 worktree（主目录 + admin + web）
- [ ] `git branch` 显示 3 个分支：`main`、`feat/admin`、`feat/web`
- [ ] 主目录与每个子 worktree 根部都有 `.claude-role.md` 且内容对应身份
- [ ] 在 admin worktree 尝试 `git checkout main` 会被 git 拒绝（"already checked out"）
- [ ] `.gitignore` 包含 `worktrees/`、`.claude-role.md`、`.env`、`node_modules`
- [ ] `bash scripts/sync-from-main.sh` 在 admin worktree 可执行（即使无变更也成功退出）

---

## §10 与远程仓库的过渡

当将来需要推到远程：

```bash
# 主目录执行一次
git remote add origin <url>
git push -u origin main
git push origin feat/admin feat/web
```

之后日常工作流不变。`sync-from-main.sh` 中可选地加入 `git fetch origin main` 步骤（脚本里已有注释占位）。

---

## §11 v0.2 简化变更说明

> 历史背景：v0.1 设计中曾有独立的 `core/main` 分支供 A 工作，main 仅作合并枢纽。实测发现 v0.1 单人开发场景下，A 与合并枢纽是同一个人，双分支会强制每次合并后让 A 跑 `git rebase main core/main` 绕一圈，纯仪式开销。

**v0.2 调整**：

- ❌ 删除 `core/main` 分支与 `worktrees/core/`
- ✅ 主目录（branch=main）即 A 的工作区 + 合并枢纽
- ❌ `scripts/sync-from-core.sh` 删除
- ✅ 新增 `scripts/sync-from-main.sh`（B/C 直接 rebase main）
- ✅ `scripts/role-templates/role-main.md` 合并原 role-core.md 内容（双重身份）
- ❌ 删除 `scripts/role-templates/role-core.md`

未来若团队扩到多人 + 需要"稳定 release / 活跃 dev"分离时，再恢复 `core/main` 不迟。

---

> **本文件 + `.claude-role.md` 是 3 进程并行的强约束。任何越界视为 bug。**
