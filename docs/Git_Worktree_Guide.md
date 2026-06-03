# Git Worktree 协作指南 — 3 进程并行开发

> 本文件规定 3 个 Claude Code 进程（**总控 / 运营端 / 学生端**）在同一个 git 仓库下并行工作时的边界、同步协议与日常命令。
>
> | 版本 | 日期 | 说明 |
> |---|---|---|
> | v0.1 | 2026-06-03 | 首次发布；适用于 v0.1 MVP 阶段离线开发（无 remote） |

---

## §1 设计原则（一句话）

> **路径所有权 + 单向同步 + 无 remote 也能协作**：每个 worktree 只写自己的目录，core 是公共代码的唯一源头，admin/web 单向从 core 拉取；本地多 worktree 共享同一 `.git/`，物理上不需要远程仓库。

---

## §2 Worktree 与分支拓扑

```
hao-hao-study/                       ← 主目录（git 库实体所在）
├── .git/                            ← 共享给所有 worktree
├── (主 worktree, branch=main)        ← 你日常 cd 进来的地方；只用作合并枢纽
└── worktrees/
    ├── core/    branch: core/main   ← Claude A 总控
    ├── admin/   branch: feat/admin  ← Claude B 运营端
    └── web/     branch: feat/web    ← Claude C 学生端
```

| Worktree | 分支 | 跑哪个 Claude Code | 用途 |
|---|---|---|---|
| 主目录（`./`） | `main` | （不跑 Claude） | 合并枢纽；用户在这里手动 merge feat 分支 |
| `worktrees/core/` | `core/main` | Claude A | 公共代码、配置、文档、脚本、迁移 |
| `worktrees/admin/` | `feat/admin` | Claude B | 仅 `apps/admin/**` |
| `worktrees/web/` | `feat/web` | Claude C | 仅 `apps/web/**` |

> ⚠️ 同一个分支不能在多个 worktree 同时 checkout，git 会报 `already checked out`。这是天然的越界保护。

---

## §3 路径所有权矩阵（防冲突的核心）

> 图例：✏️ = 可写、👁️ = 只读、🚫 = 不应访问（即使读也不要依赖）

| 路径 | core (A) | admin (B) | web (C) | main（合并） |
|---|---|---|---|---|
| `packages/db/**` | ✏️ | 👁️ | 👁️ | 🚫 |
| `packages/llm/**` | ✏️ | 👁️ | 👁️ | 🚫 |
| `packages/shared/**` | ✏️ | 👁️ | 👁️ | 🚫 |
| `packages/ui/**` | ✏️ | 👁️ | 👁️ | 🚫 |
| `apps/admin/**` | 👁️ | ✏️ | 🚫 | 🚫 |
| `apps/web/**` | 👁️ | 🚫 | ✏️ | 🚫 |
| `docs/**` | ✏️ | 🚫 | 🚫 | 🚫 |
| `scripts/**` | ✏️ | 🚫 | 🚫 | 🚫 |
| `.github/**` | ✏️ | 🚫 | 🚫 | 🚫 |
| 根配置（见 §3.1） | ✏️ | 🚫 | 🚫 | 🚫 |
| 根 `pnpm-lock.yaml` | ✏️（见 §3.2） | 🚫提交 | 🚫提交 | ✏️（合并时） |

### §3.1 根配置文件清单（仅 core 可改）

```
package.json
pnpm-workspace.yaml
tsconfig.base.json
biome.json
docker-compose.yml
.env.example
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
3. **lockfile 的提交统一发生在合并到 main 后**（由 main worktree 的合并者 / core 重新跑一次 `pnpm install` 并提交）

实操：B/C 的 commit 命令统一加 `--` 排除：

```bash
git add apps/admin -- ':!pnpm-lock.yaml'
```

或在 `.gitattributes` 里把 lockfile 设为 merge=ours（更彻底，但 core 必须及时重生）。本文件采用前者（手动排除）。

---

## §4 单向同步协议

```
            ┌──────────────────┐
            │  core/main (A)   │
            └────────┬─────────┘
                     │ ① A 提交后通知用户
        ┌────────────┴────────────┐
        ▼                         ▼
   ② B rebase                ② C rebase
   feat/admin                feat/web
        │                         │
        │ ③ B 完成功能              │ ③ C 完成功能
        └─────────► main ◄─────────┘
                     │ ④ A 周期 rebase main 回 core/main
                     ▼
               core/main 同步
```

| 步 | 动作 | 谁执行 | 命令 |
|---|---|---|---|
| ① | A 在 `core/main` 提交公共变更 | Claude A | `git add ... && git commit -m "..."` |
| ② | B/C 拉取 A 的最新变更 | 用户在 B/C worktree | `bash ../../scripts/sync-from-core.sh` |
| ③ | B/C 把功能合并回 `main` | 用户在主目录 | `bash scripts/merge-to-main.sh feat/admin` |
| ④ | A 周期把 `main` 拉回 `core/main` | Claude A | `git rebase main` |

**B 与 C 永远不直接交互**——切断横向冲突。

---

## §5 角色边界文件 `.claude-role.md`

每个 worktree 启动 Claude Code 前，根目录会有一份**未入 git** 的 `.claude-role.md`，由 `setup-worktrees.sh` 脚本从 `scripts/role-templates/` 拷贝生成。

`AGENTS.md` 强约束：所有 Claude Code 启动时**必须先读 `.claude-role.md`**（如存在），按其边界严格工作。

文件位置：

| Worktree | `.claude-role.md` 内容来源 |
|---|---|
| `worktrees/core/` | `scripts/role-templates/role-core.md` |
| `worktrees/admin/` | `scripts/role-templates/role-admin.md` |
| `worktrees/web/` | `scripts/role-templates/role-web.md` |
| 主目录 | `scripts/role-templates/role-main.md` |

---

## §6 一次性初始化

### §6.1 初始化命令

在仓库根目录执行：

```bash
bash scripts/setup-worktrees.sh
```

该脚本会：

1. 若仓库未 `git init`，先初始化 + 首次 commit
2. 创建 `main` 分支（若不存在）
3. 创建 3 个分支：`core/main`、`feat/admin`、`feat/web`
4. 创建 3 个 worktree：`worktrees/core`、`worktrees/admin`、`worktrees/web`
5. 拷贝 `.claude-role.md` 到每个 worktree
6. 创建 `.env` symlink 链（如果根目录有 `.env` 文件）

### §6.2 拉起 3 个 Claude Code 进程

打开 3 个终端，分别 cd 到各自 worktree：

```bash
# 终端 1（总控）
cd worktrees/core && claude

# 终端 2（运营端）
cd worktrees/admin && claude

# 终端 3（学生端）
cd worktrees/web && claude
```

每个进程启动时会自动读到根目录的 `.claude-role.md`，明确知道自己的工作边界。

---

## §7 日常命令清单

### §7.1 A（总控）日常

```bash
cd worktrees/core

# 改完 packages/* 或 docs/* 后
git add packages docs
git commit -m "feat(db): 添加 PARSE_JOB.cost_estimate 字段"

# 周期同步 main 上的 B/C 功能合并
git rebase main
```

A **绝不**改 `apps/admin/**` 或 `apps/web/**`，遇到这种需求让用户在 B/C 进程处理。

### §7.2 B（运营端）日常

```bash
cd worktrees/admin

# 收到 A "core/main 已更新" 通知后
bash ../../scripts/sync-from-core.sh

# 改完 apps/admin/* 后
git add apps/admin -- ':!pnpm-lock.yaml'
git commit -m "feat(admin): 实现 F3.4 单题 diff 抽屉"
```

### §7.3 C（学生端）日常

```bash
cd worktrees/web

# 收到 A "core/main 已更新" 通知后
bash ../../scripts/sync-from-core.sh

# 改完 apps/web/* 后
git add apps/web -- ':!pnpm-lock.yaml'
git commit -m "feat(web): 实现 G3.3 提交事务前端调用"
```

### §7.4 用户（合并枢纽）日常

当 B 或 C 完成一个独立功能要合到 `main`：

```bash
# 在主目录执行（不在 worktrees/ 内）
cd /Users/huyin/Swingboat/github/hao-hao-study
bash scripts/merge-to-main.sh feat/admin     # 或 feat/web
```

该脚本：
1. 切到 `main` 分支（主目录这个 worktree）
2. `git merge --no-ff feat/admin`
3. 重新 `pnpm install` 解决 lockfile
4. 自动 commit lockfile
5. 切回主目录原状态

---

## §8 冲突预案

### §8.1 rebase 时遇到冲突

`sync-from-core.sh` 失败时不要硬抢。退出脚本，让用户决定：

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

- [ ] `git worktree list` 显示 4 个 worktree（主目录 + 3 个 sub）
- [ ] `git branch` 至少显示 4 个分支：`main`、`core/main`、`feat/admin`、`feat/web`
- [ ] 每个 worktree 根目录有 `.claude-role.md` 文件且内容对应身份
- [ ] 在 admin worktree 尝试 `git checkout core/main` 会被 git 拒绝（"already checked out"）
- [ ] `.gitignore` 包含 `worktrees/`、`.claude-role.md`、`.env`、`node_modules`
- [ ] `bash scripts/sync-from-core.sh` 在 admin worktree 可执行（即使无变更也成功退出）

---

## §10 与远程仓库的过渡

当将来需要推到远程：

```bash
# 主目录执行一次
git remote add origin <url>
git push -u origin main
git push origin core/main feat/admin feat/web
```

之后日常工作流不变。`sync-from-core.sh` 中可选地加入 `git fetch origin core/main` 步骤（脚本里已有注释占位）。

---

> **本文件 + `.claude-role.md` 是 3 进程并行的强约束。任何越界视为 bug。**
