# AGENTS.md

本文件为 AI 协作代理（Claude Code、Codex 等）在本仓库工作时的统一规则来源。

## 通用规则

1. **文档语言**：所有文档（包括 README、设计文档、说明文件等）统一使用中文编写。
2. **文档位置**：所有文档统一存放在 `docs/` 目录下。仓库根目录仅保留 `CLAUDE.md`、`AGENTS.md`、`README.md` 等入口文件。
3. **规则维护**：未来新增的项目规则一律写入本文件（`AGENTS.md`），`CLAUDE.md` 仅作为入口引用，避免规则分散。
4. **抽象层强制**：业务代码不得直连基础设施，必须经统一抽象层。**所有 PR / 提交前自检本规则**。

   | 关注点 | 必须经过 | 禁止直连 | 实现文档 |
   |---|---|---|---|
   | 写/读文件、生成派生资产 | `@hao/storage` 的 `ObjectStore`（`createStore()` 获取实例，路径走 `StoragePaths`） | `node:fs` 直接读写"业务文件"（上传、派生 PNG、LLM 中间产物、figure 切片） | `docs/File_Storage_v0.1.md` |
   | 访问 LLM | `@hao/llm` 的 `callLLM()` 或其高层封装（`analyzeImages` / `analyzeImagesToStorage` / `analyzePdfWithVision` / `cropFiguresToStorage` …）；provider 元数据走 `llm_provider` 表 | `fetch()` 直连 LLM 端点、硬编码 endpoint / model / token；新业务**不要**再用 `analyzePdf`（bedrock_converse 路径，已软弃用，见下） | `docs/Tech_Stack_MVP_v0.1.md` §2.3 + `packages/llm/src/callLLM.ts` |
   | F4.3 KP 解析 | `apps/admin/lib/kp-pipeline-vision.ts`（pdftoppm + Gemini vision；webex-gemini-3.1-pro 默认） | `apps/admin/lib/kp-pipeline.ts` —— Converse 路径已 `@deprecated`，仅作回滚保底 | commit `a1f4865` + 本次 vision 切换 |
   | 文件解析（轻量场景）—— file + prompt → text | `@hao/llm` 的 `analyzeFile.{image,pdf}()` 傻瓜入口（L0） | 手动 `rasterize` + 自己写循环 | `packages/llm/src/analyze-file.ts` |
   | PDF 教材/试卷抽题（"不丢题"硬指标） | `@hao/llm` 的 `extractItemsFromPdf()`（L2，含完整性自检 + 边界重抽 + dedup + figure crop） | `analyzeFile.pdf` 或 `analyzeImagesToStorage`（这两者不解决跨页题问题） | `packages/llm/src/vision/extract-items-from-pdf.ts` |
   | PDF 抽题（无跨页要求） | `@hao/llm` 的 `analyzePdfWithVision()`（自动 rasterize → 调 LLM → bbox 裁切 → 落 storage + 汇总 derived_asset 候选） | 业务里自己拼 `rasterizePdf` + `analyzeImages` + `cropFiguresToStorage`（如要细控可用低层 API，但需在调用处注释原因） | `packages/llm/src/pdf/analyze-pdf-with-vision.ts` |

   **`@hao/llm` 分层速查**（v0.1）：
   - **L0**（傻瓜入口）`analyzeFile.{image, pdf}` — file + prompt → `{text, perPage}`；单图问答、PDF 内容总结。**不**做 figure / storage / 跨页修复。
   - **L1**（端到端 PDF 入口）`analyzePdfWithVision` — rasterize → 抽题 + figure crop + derived_asset。**不**修跨页题。
   - **L2**（教材抽题流水线）`extractItemsFromPdf` — chunked + 完整性自检 + 边界重抽 + dedup + figure crop。教材/试卷不丢题硬指标走这里。
   - **L2-中间**（公共子流程）`analyzeImagesToStorage` — image batch → 抽题 + figure crop；L1 内部调它，独立 image batch 抽题也可用。
   - **L3**（原语）`callLLM` / `rasterizePdf` / `analyzeImages`（每图一次）/ `analyzeImageBatch`（一次多图）/ `cropFiguresToStorage`。

   **bedrock_converse 路径软弃用**（v0.1 阶段决策）：`analyzePdf`（Bedrock Converse 原生 PDF）在 Webex proxy 上 429 触发率过高，已加 `@deprecated` 注释。代码与测试保留作高精度 baseline 备选，但**新业务一律走 vision 路径**（L0/L1/L2 都是），DB 里 `protocol=bedrock_converse` 的 provider 不要选。

   **例外**（允许直连底层，不需要走抽象层）：
   - 抽象层自身的实现（`packages/storage/src/fs-store.ts` 用 `fs`、`packages/llm/src/callLLM.ts` 用 `fetch`）
   - `scripts/probe-*.ts` 这类一次性探针/实验脚本（结果落到 `results/` 即 throwaway）
   - 单元测试 / 集成测试

   **新加抽象层时**：先扩接口（如 `ObjectStore.copy()`），再在所有实现里支持，最后业务调用。不要在业务代码里写 "if fs then ... else if s3 then ..." 分支。

   **新加 LLM provider 时**：通过 `llm_provider` 表落库（`packages/db/prisma/seed.ts`），让 `callLLM(providerId)` 自动 dispatch；不要在业务代码里 import 具体 adapter。


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

