# 好好学习（Hao-Hao Study）

> 智能学习助手 v0.1 MVP — 中国教育"错题本 + 间隔复习 + 三池凑题"的现代化实现。

## 文档入口

| 文档 | 用途 |
|---|---|
| [`AGENTS.md`](./AGENTS.md) | AI 代理（Claude Code / Codex）协作规则 |
| [`docs/PRD/SmartLearningAssistant_PRD.md`](./docs/PRD/SmartLearningAssistant_PRD.md) | 主 PRD v1.1（数据模型 + 核心闭环） |
| [`docs/PRD/Operator_Console_MVP_PRD.md`](./docs/PRD/Operator_Console_MVP_PRD.md) | 运营端 PRD v0.1（F1–F7 共 18 个 TAV） |
| [`docs/PRD/Student_Web_MVP_PRD.md`](./docs/PRD/Student_Web_MVP_PRD.md) | 学生端 PRD v0.1（G1–G5 + 主旅程 V1） |
| [`docs/Tech_Stack_MVP_v0.1.md`](./docs/Tech_Stack_MVP_v0.1.md) | 技术栈 D1–D5 + M0–M10 交付清单 |
| [`docs/Git_Worktree_Guide.md`](./docs/Git_Worktree_Guide.md) | 3 进程并行开发的 worktree 协议 |

## 仓库结构

```
hao-hao-study/
├── apps/
│   ├── admin/              # 运营端 Next.js（@hao/admin，端口 3001）
│   └── web/                # 学生端 Next.js（@hao/web，端口 3000）
├── packages/
│   ├── db/                 # Prisma schema + client（@hao/db）
│   ├── shared/             # 跨端共享业务逻辑（@hao/shared）
│   ├── llm/                # LLM Proxy 抽象层（@hao/llm）
│   └── ui/                 # 共享 React 组件（@hao/ui）
├── docs/                   # PRD + Tech Stack + 协作协议
├── scripts/                # worktree 初始化与同步脚本
├── docker-compose.yml      # 本地 PG 16 + Redis 7
├── package.json            # 根脚本
├── pnpm-workspace.yaml     # workspace 声明
├── tsconfig.base.json      # 共享 TS 配置（含 @hao/* path 映射）
├── biome.json              # lint + format
└── .env.example            # 环境变量样例
```

## 快速上手

```bash
# 0. 准备 Node 22+ 与 pnpm 10+
node -v && pnpm -v

# 1. 起本地依赖（PostgreSQL 16 + Redis 7）
pnpm docker:up

# 2. 装依赖
pnpm install

# 3. 准备环境变量
cp .env.example .env

# 4. 生成 Prisma client + 迁库
pnpm db:generate
pnpm db:migrate

# 5. 起开发服务（任选）
pnpm dev:admin     # 运营端 http://localhost:3001
pnpm dev:web       # 学生端 http://localhost:3000
```

## 3 进程并行开发

本仓库设计为 **总控 / 运营端 / 学生端 3 个 Claude Code 进程并行**。详见 [`docs/Git_Worktree_Guide.md`](./docs/Git_Worktree_Guide.md)。

```bash
# 一次性初始化 worktree（创建 worktrees/admin 和 worktrees/web）
bash scripts/setup-worktrees.sh
```

之后在不同终端启动 Claude Code：

```bash
# 终端 1（总控 A，同时是合并枢纽）—— 在主目录
cd /Users/huyin/Swingboat/github/hao-hao-study && claude

# 终端 2（运营端 B）
cd worktrees/admin && claude

# 终端 3（学生端 C）
cd worktrees/web && claude
```

## 文档语言

所有文档统一使用中文（详见 [`AGENTS.md`](./AGENTS.md)）。
