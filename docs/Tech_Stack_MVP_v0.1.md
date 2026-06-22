# 技术栈决策与交付计划 — MVP v0.1

> 本文件为 `SmartLearningAssistant_PRD.md` v1.0 + `Operator_Console_MVP_PRD.md` v0.1 + `Student_Web_MVP_PRD.md` v0.1 的**技术实现契约**。
>
> | 版本 | 日期 | 说明 |
> |---|---|---|
> | v0.1 | 2026-06-03 | 首次发布；D1–D5 决策已拍板，对应主 PRD §10.5 启动确认事项 |

---

## §1 决策摘要（D1–D5）

| 编号 | 议题 | 决议 | 理由 |
|---|---|---|---|
| **D1** | 部署区域 / 合规 | **海外**：Vercel + Neon（US/EU）+ Upstash + Cloudflare R2 | v0.1 亲友内测 < 50 人，无 ICP 备案压力；上线快、运维省。开放注册前再评估迁国内 |
| **D2** | 仓库结构 | **monorepo**（pnpm workspaces，web端 / admin端共仓） | 共享数据模型（14 张表）与三池凑题逻辑，monorepo 减少同步成本 |
| **D3** | ORM | **Prisma 6** | 迁移工具完备，jsonb / uuid[] / 复合主键原生支持，团队上手成本低 |
| **D4** | 学生 / 运营域名分离 | **不同子域**：`app.*`（学生）vs `admin.*`（运营） | cookie 完全隔离，安全审计省事，避免路径前缀的鉴权中间件复杂度 |
| **D5** | LLM 抽象层 | **自写 fetch + 协议适配**，不引入 SDK | LLM Proxy 端点形态多样，SDK 反而碍事；自写适配层易维护 |

---

## §2 完整技术栈

### §2.1 应用层

| 层 | 选型 | 用途 |
|---|---|---|
| 前端框架 | **Next.js 15（App Router）+ React 19 + TypeScript 5** | web端 / admin端共用 monorepo，SSR + RSC 加速首屏 |
| UI 库 | **shadcn/ui + Tailwind CSS 4** | 现代审美组件库，可拷贝可改 |
| 客户端状态 | **Zustand** | Session 答题暂存 / 客户端轻量 store |
| 服务端状态 | **TanStack Query v5** | 数据获取、缓存、mutation |
| API 层 | **Next.js Route Handlers + tRPC v11** | 端到端类型安全；PRD §6 读写边界用 zod schema 强制 |
| 表单与校验 | **react-hook-form + zod** | 前后端 schema 共享 |
| 鉴权 | **Auth.js v5（NextAuth 后继）** credentials provider | 学生 / 运营双 session，HTTP-only cookie，TTL 12h |

### §2.2 数据层

| 层 | 选型 | 用途 |
|---|---|---|
| 数据库 | **PostgreSQL 16** | 主存储；jsonb / uuid[] / UNIQUE / 复合主键支持 |
| ORM | **Prisma 6** | schema-first 迁移管理 |
| 缓存 / 队列 | **Redis 7（Upstash）** | LLM 解析任务队列 + Auth 速率限制 + Session 状态 |
| 队列框架 | **BullMQ** | LLM 解析任务异步执行，并发上限 ≤ 2（admin端 PRD §3.5） |
| 对象存储 | **Cloudflare R2** | UPLOAD_RECORD 文件存档（PDF / Word / 图片，单文件 ≤ 20MB） |

### §2.3 LLM 接入

| 层 | 选型 | 用途 |
|---|---|---|
| 同步层 | **`packages/llm/src/business|documents|llm|types|display`** | 与 `how-to-use-llm-proxy/src` 同名目录/文件保持一致；承载 prompt、文档渲染、LLM 调用和解析逻辑 |
| 当前项目适配层 | **`packages/llm/src/adapter`** | `providerId → llmTarget/apiKey`，对外主入口为 `analyzeKnowledgePoints` / `analyzeLearningResource`；`analyzeQuestions` 保留为兼容/专项能力 |
| 教育解析编排 | **`analyzeKnowledgePoints` / `analyzeLearningResource`**（packages/llm） | LLM 业务解析能力先在 `how-to-use-llm-proxy` 验证通过，再同步到本包；业务侧不要直接拼 prompt / schema / PDF 渲染 / LLM 循环 |
| Provider 1 | `openai-chat-gemini-3.1-pro` | OpenAI-compatible 协议；文本 KP / Goal Template 解析 |
| Provider 2 | `google-generate-content-gemini-3-pro-image` | Google GenerateContent 协议；图片 / 题集 vision 解析 |
| Provider 3 | `openai-chat-claude-opus-4.7` | OpenAI-compatible 协议；纯文本 KP 抽取生产首选（探针 113/113 通过） |
| Provider 4 | `bedrock-converse-claude-opus-4.7` | Bedrock Converse 协议；Claude Opus 4.7 备用接入 |
| Token 管理 | env var `LLM_PROXY_API_KEY`，运行时读取 | 不入库、不出现在前端、不打日志 |
| 日志脱敏 | `how-to-use-llm-proxy` 同步层 `payload-log` | payload 日志能力随同步层演进；业务侧不自行记录明文 token |

### §2.4 测试与质量

| 层 | 选型 | 用途 |
|---|---|---|
| 单测 | **Vitest** | 工具函数 / 业务规则纯函数 |
| 集成测试 | **Vitest + Testcontainers (PostgreSQL)** | G3.3 事务原子性 / S2 unlocked 过滤等需要真实 DB 的场景 |
| E2E | **Playwright** | 主旅程 V1 / U1 + 全部 T 系列 CI 用例 |
| 类型检查 | **tsc --noEmit** + **Prisma generate** | 强类型贯通 |
| Lint | **Biome**（替代 ESLint + Prettier） | 一个工具链做 lint + format |

### §2.5 运维与监控

| 层 | 选型 | 用途 |
|---|---|---|
| 部署平台 | **Vercel**（双 app：apps/web, apps/admin） | Serverless + 全球 CDN |
| DB Hosting | **Neon**（PostgreSQL 16） | Serverless Postgres + Branch 支持 staging |
| Redis Hosting | **Upstash** | Serverless Redis + Ratelimit SDK |
| 对象存储 | **Cloudflare R2** | 免出口费 |
| CI/CD | **GitHub Actions** | lint / typecheck / vitest / playwright smoke |
| 错误监控 | **Sentry** | 前后端错误 + LLM 调用异常 |

---

## §3 仓库结构

```
hao-hao-study/
├── apps/
│   ├── web/                          ← web端 Next.js（域名 app.*）
│   │   ├── app/
│   │   │   ├── (auth)/login/
│   │   │   ├── (auth)/consent/        ← G1.3 监护人同意
│   │   │   ├── (app)/page.tsx         ← G2.1 首页
│   │   │   ├── (app)/session/[id]/
│   │   │   ├── (app)/errors/
│   │   │   └── (app)/me/
│   │   └── package.json
│   └── admin/                         ← admin端 Next.js（域名 admin.*）
│       ├── app/
│       │   ├── login/
│       │   ├── (admin)/page.tsx       ← F6.1 看板
│       │   ├── (admin)/questions/import/
│       │   ├── (admin)/kps/
│       │   ├── (admin)/students/
│       │   ├── (admin)/settings/llm/
│       │   └── (admin)/audit/parse-jobs/
│       └── package.json
├── packages/
│   ├── db/                            ← Prisma schema + migrations + seed
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   └── package.json
│   ├── llm/                           ← LLM 抽象层
│   │   ├── src/
│   │   │   ├── adapter/               ← 当前项目薄适配层，对外包入口
│   │   │   ├── business/              ← 从 how-to-use-llm-proxy 同步
│   │   │   ├── documents/             ← 从 how-to-use-llm-proxy 同步
│   │   │   ├── llm/                   ← 从 how-to-use-llm-proxy 同步
│   │   │   ├── types/                 ← 从 how-to-use-llm-proxy 同步
│   │   │   └── display/               ← 从 how-to-use-llm-proxy 同步
│   │   └── package.json
│   ├── shared/                        ← 跨端共享业务逻辑
│   │   ├── src/
│   │   │   ├── labels/                ← 年级 / 学段展示标签
│   │   │   ├── prompts/               ← LLM prompt 模板
│   │   │   └── schemas/               ← zod schemas
│   │   └── package.json
│   └── ui/                            ← shadcn 组件公用层
│       └── package.json
├── docs/                              ← PRD + Tech Stack
├── docker-compose.yml                 ← 本地 PG + Redis
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── biome.json
└── .env.example
```

---

## §4 环境变量

```bash
# ─── 数据库与缓存 ───
DATABASE_URL=postgres://...
REDIS_URL=redis://...

# ─── 对象存储（Cloudflare R2）───
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=hao-hao-uploads
R2_PUBLIC_URL=https://...

# ─── LLM ───
LLM_PROXY_API_KEY=...                # ⚠️ 仅运行时读取，禁止入库 / 入日志 / 入前端 bundle
LLM_PROXY_OPENAI_CHAT_ENDPOINT=...
LLM_PROXY_GOOGLE_GENERATE_CONTENT_GEMINI_3_PRO_IMAGE_ENDPOINT=...
LLM_PROXY_BEDROCK_CONVERSE_CLAUDE_OPUS_4_7_ENDPOINT=...

# ─── 鉴权 ───
AUTH_SECRET=...                      # Auth.js 签名密钥
ADMIN_USERNAME=admin                 # admin端单一管理员账号
ADMIN_PASSWORD_HASH=$argon2id$...    # argon2 哈希

# ─── 监控 ───
SENTRY_DSN=...
SENTRY_AUTH_TOKEN=...                # source map 上传

# ─── 域名 ───
NEXT_PUBLIC_APP_URL=https://app.example.com
NEXT_PUBLIC_ADMIN_URL=https://admin.example.com
```

> ⚠️ `.env` 永不进 Git；`.env.example` 仅含变量名，无值。

---

## §5 关键技术风险与对策

| 风险 | 对策 | 验收测试 |
|---|---|---|
| **G3.3 事务原子性**：跨 6 步，默认隔离级别可能不够 | Prisma `$transaction({ isolationLevel: 'Serializable' })` + 失败重试 1 次 | web端 T5（故障注入） |
| **PARSE_JOB 大文件**：PDF 单次可能超 LLM token 上限 | 上传时按页切片，每页一个 PARSE_JOB；UI 合并 staging 展示 | admin端 §5.2 Q2 延迟 P95 ≤ 60s |
| **LLM Proxy 不稳定**：代理 5xx 概率 | 同步层逐页解析支持 retry；失败落 `PARSE_JOB.status='failed'`；admin端 F3.6 单条重跑兜底 | admin端 T10（mock 5xx） |
| **web端 unlocked 过滤漏判**：任何漏过滤即数据泄漏 | tRPC middleware 注入 student context；DB 查询统一通过 `withUnlockedFilter()` helper | web端 T3 / T9 |
| **Auth.js 单管理员账号防爆破** | Upstash Ratelimit：错误 5 次 → 锁 IP 15 分钟 | 单测 + 手动渗透测试 |
| **Vercel serverless 冷启动** | DB / Redis 同区域；关键路径预热 cron 每 5 min ping `/api/health` | RUM 监控 P95 |
| **Token 泄漏到日志或响应** | adapter 只从 env 读取 token 并注入同步层调用；业务侧不记录明文 token | admin端 T2 / T9 |
| **Prisma 客户端在 serverless 冷启动慢** | 使用 `@prisma/adapter-neon` + connection pooling | RUM 监控 |

---

## §6 交付组件清单（M0–M10）

> 不写时间，按依赖顺序排列。每个组件独立可验收。

| 序 | 组件 | 路径 | 验收标志 | 依赖 |
|---|---|---|---|---|
| **M0** | Monorepo 骨架 | 根目录 + apps/* + packages/* | `pnpm install && pnpm build` 全绿 | — |
| **M1** | Prisma schema + 迁移 + seed | packages/db | `pnpm db:migrate && pnpm db:seed` 在空 PG 一次成功，14 张表齐 | M0 |
| **M2** | LLM 抽象层 | packages/llm | 同步层与 `how-to-use-llm-proxy/src` 对齐；adapter 的 `providerId → llmTarget/apiKey` 单测通过 | M0 |
| **M3** | Auth.js 双角色 + 子域路由 | apps/web + apps/admin | app.* / admin.* cookie 隔离；未登录跳各自 login | M0 |
| **M4** | 三池凑题逻辑 | packages/shared/recommender | 主 PRD §G3.1 三池合并去重 + unlocked 过滤纯函数 + 集成测试覆盖 T3/T4 | M1 |
| **M5** | G3.3 提交事务 | packages/shared/session-commit | 6 步事务 + Serializable + 故障注入测试 T5/T6/T7/T8/T12 全过 | M1, M4 |
| **M6** | web端核心闭环 UI | apps/web | 主旅程 V1 端到端跑通；T1/T2/T9/T10/T11 全过 | M3, M4, M5 |
| **M7** | admin端 LLM 解析管线 | apps/admin（F2/F3 组） | 主旅程 U1 步骤 4–6 走通；T2/T3/T4/T7/T9/T10 全过 | M2, M3 |
| **M8** | admin端学生开户 + 合规 | apps/admin（F5 组） | T5/T6 全过；与web端 G1.3 联调通过 | M3 |
| **M9** | 错题本 / 合规自助 / 看板 | apps/web G4/G5 + apps/admin F6/F7 | 全部剩余 TAV 可演示 | M6, M7, M8 |
| **M10** | CI / 部署 / 监控 | .github/workflows + Vercel + Sentry | GitHub Actions 全绿；Vercel 双 app + Neon + Upstash + R2 + Sentry 接通 | M6, M7 |

### §6.1 起步 3 件套（M0 + M1 + M2，可并行）

> 三者无相互依赖，可一次性产出。M1 是后续一切的契约，建议先单独评审 schema.prisma 再推进 M0/M2。

---

## §7 与 PRD 的契约边界

| 契约项 | PRD 来源 | 实现位置 |
|---|---|---|
| 14 张表的字段 / 主键 / 唯一约束 | 主 PRD §3 + §10.4 + admin端 §6 | `packages/db/prisma/schema.prisma` |
| 三池凑题规则 | web端 G3.1 | `packages/shared/recommender/` |
| Mastery 增减规则 | 主 PRD §10.2 + §5.1 | `packages/shared/mastery/` |
| ERROR_LOG 连续 2 次对自动 resolve | 主 PRD 决议 S2-N=2 | `packages/shared/session-commit/` |
| Layer 3 触发器 A / B（仅这两个） | web端 G3.3 | `packages/shared/session-commit/` |
| LLM Provider 协议适配 | admin端 §7 | `packages/llm/src/adapter/provider-target.ts` + `packages/llm/src/llm/llm-client.ts` |
| Token 处理 | admin端 T9 | `llm_provider.auth_env_var` + `packages/llm/src/adapter/provider-target.ts` |
| unlocked_kp_ids 过滤 | web端 T3 / T9 | `packages/shared/db-helpers/` |

任何 PRD 中未声明、本文件未约束的实现细节，由开发自行决定，但需符合：

- TypeScript 严格模式（`strict: true`）
- 所有 API 端点返回 zod 校验过的数据
- 数据库写入操作必须经过 Prisma `$transaction` 或 schema 约束

---

## §8 安全检查清单

实施 M10 前必须全部 ✅：

- [ ] `LLM_PROXY_API_KEY` 已轮换（旧 token 在对话历史中已暴露）
- [ ] CI grep 全代码库无明文 token / password / secret
- [ ] `.env` 不在 Git 历史中
- [ ] PARSE_JOB.request_payload 入库前已脱敏（admin端 T9 单测覆盖）
- [ ] web端所有 tRPC procedure 经过 `withUnlockedFilter()`（web端 T9）
- [ ] admin端登录有速率限制（Upstash Ratelimit）
- [ ] Auth.js cookie 配置 `httpOnly: true, secure: true, sameSite: 'lax'`
- [ ] R2 bucket 私有，仅签名 URL 访问
- [ ] Sentry 配置 PII 过滤（不上报学生姓名 / 答案明文）

---

> **本文件为 PRD 三件套的技术实现契约。任何技术决策变更需更新本文件并标注版本。**
