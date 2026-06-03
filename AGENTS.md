# AGENTS.md

本文件为 AI 协作代理（Claude Code、Codex 等）在本仓库工作时的统一规则来源。

## 通用规则

1. **文档语言**：所有文档（包括 README、设计文档、说明文件等）统一使用中文编写。
2. **文档位置**：所有文档统一存放在 `docs/` 目录下。仓库根目录仅保留 `CLAUDE.md`、`AGENTS.md`、`README.md` 等入口文件。
3. **规则维护**：未来新增的项目规则一律写入本文件（`AGENTS.md`），`CLAUDE.md` 仅作为入口引用，避免规则分散。

## Worktree 协作协议（v0.1 MVP 阶段）

本仓库采用 **3 个 Claude Code 进程并行开发**，依赖 git worktrees 隔离。详见 [`docs/Git_Worktree_Guide.md`](./docs/Git_Worktree_Guide.md)。

**所有 Claude Code 启动时必须执行的第一步：**

1. 检查当前工作目录根部是否存在 `.claude-role.md` 文件
2. 若存在，**先完整阅读该文件**，按其中规定的"可写目录"与"禁止目录"严格工作
3. 用户要求改动超出 `.claude-role.md` 边界时，**拒绝并提示用户切换到正确的 worktree**

`.claude-role.md` 由 `scripts/setup-worktrees.sh` 拷贝生成，**未入 git**，是每个 worktree 独立的身份令牌。

**路径所有权速查**（详见 `docs/Git_Worktree_Guide.md` §3）：

| Worktree | 可写 |
|---|---|
| 主目录（`./`，总控 + 合并枢纽，branch=main） | `packages/**`、`docs/**`、`scripts/**`、根配置；执行 merge feat → main |
| `worktrees/admin/`（运营端，branch=feat/admin） | `apps/admin/**` |
| `worktrees/web/`（学生端，branch=feat/web） | `apps/web/**` |

## 项目状态

仓库当前处于 v0.1 MVP 启动阶段。设计文档已完整：

- `docs/PRD/SmartLearningAssistant_PRD.md` — 主 PRD v1.1
- `docs/PRD/Operator_Console_MVP_PRD.md` — 运营端 MVP PRD v0.1
- `docs/PRD/Student_Web_MVP_PRD.md` — 学生端 MVP PRD v0.1
- `docs/Tech_Stack_MVP_v0.1.md` — 技术栈与交付计划 v0.1
- `docs/Git_Worktree_Guide.md` — 3 进程协作协议 v0.1

待代码引入后，请在此文件补充：

- 常用命令（构建、测试、运行、Lint）
- 代码架构与模块划分
- 其他项目特定约定

