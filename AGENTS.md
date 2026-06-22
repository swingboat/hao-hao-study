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
   | 访问 LLM | 只通过 `@hao/llm` adapter 暴露的业务入口（当前为 `analyzeKnowledgePoints` / `analyzeLearningResource`，`analyzeQuestions` 仅作兼容/专项能力）；provider 元数据走 `llm_provider` 表，LLM 解析实现来自 `how-to-use-llm-proxy` 同步层 | `fetch()` 直连 LLM 端点、硬编码 endpoint / model / token；业务里自己拼 prompt / schema / PDF 渲染 / LLM 循环；直接调用同步层 `llm-client` / `document-parser` 等内部原语实现业务解析 | `docs/Tech_Stack_MVP_v0.1.md` §2.3 + `packages/llm/src/adapter/index.ts` |
   | KP 解析 | `@hao/llm` 的 `analyzeKnowledgePoints()` | admin / web / admin端自己维护 KP prompt、schema、chunk、vision pipeline | `packages/llm/src/adapter/index.ts` + `packages/llm/src/business/knowledge-parser.ts` |
   | 学习资料解析 | `@hao/llm` 的 `analyzeLearningResource()` | admin / web / admin端自己判断资料类型、维护试题/讲义 prompt、schema、chunk、vision pipeline | `packages/llm/src/adapter/index.ts` + `packages/llm/src/business/education-analysis.ts` |

   **`@hao/llm` 业务入口速查**（v0.1）：
   - `analyzeKnowledgePoints` — 从教材/资料文件生成知识点。
   - `analyzeLearningResource` — 统一解析辅导资料、讲义、PPT、题集、解析册、完整试卷等学习资料，按知识点主线返回学习材料与试题。
   - `analyzeQuestions` — 兼容/专项入口，从 PDF / Word 试题文件生成试题，可接收知识点上下文；admin 主流程应优先使用 `analyzeLearningResource`。
   - `packages/llm/src/business|documents|llm|types|display` 为从 `how-to-use-llm-proxy/src` 同步来的代码，保持同名目录和文件；不要在当前仓库直接改这些文件来研发 LLM 能力。
   - `packages/llm/src/adapter` 是当前项目自己的薄适配层，负责 `providerId → llmTarget/apiKey` 和对外导出；业务代码只调 adapter 暴露的包入口。

   **例外**（允许直连底层，不需要走抽象层）：
   - 抽象层自身的实现（`packages/storage/src/fs-store.ts` 用 `fs`、同步层 `packages/llm/src/llm/llm-client.ts` 用 `fetch`）
   - `scripts/probe-*.ts` 这类一次性探针/实验脚本（结果落到 `results/` 即 throwaway）
   - 单元测试 / 集成测试

   **新加抽象层时**：先扩接口（如 `ObjectStore.copy()`），再在所有实现里支持，最后业务调用。不要在业务代码里写 "if fs then ... else if s3 then ..." 分支。

   **新加 LLM provider 时**：通过 `llm_provider` 表落库（`packages/db/prisma/seed.ts`），让 `packages/llm/src/adapter/provider-target.ts` 统一映射到同步层 `llmTarget`；不要在业务代码里 import / 实现具体协议细节。

5. **LLM 分析能力研发边界**：

   本规则适用于主目录公共层、admin端 `apps/admin`、web端 `apps/web` 以及所有 worktree。凡是需要通过 LLM 做新的分析能力、解析策略、prompt/schema 调整、模型/Provider 选择、质量评测或样例探针的需求，**不要直接在本仓库实现或试验**，也不要由代理自行调用 LLM 去完成验证。处理方式统一为：

   - 先把需求、输入样例、期望输出、质量标准和失败边界整理出来，交给 `how-to-use-llm-proxy` 项目验证。
   - 在 `how-to-use-llm-proxy` 中测试通过并沉淀为稳定公共方法 / schema / prompt 后，再同步到当前项目使用。
   - 当前项目只接入已经验证通过的公共方法；业务代码不得在本仓库临时新增 LLM 探针、一次性 prompt、私有解析循环或未验证 provider 分支。
   - 允许做的工作仅限于接线、类型适配、存储/DB 落库、UI/工作流集成，以及对已同步公共方法的常规单测。

6. **AI 学习闭环目标规则**：

   本系统使用 AI 的目标不是生成一次性页面文案，而是提升学生学习效果。凡是面向学生学习过程的 AI 输出（如练习复盘、薄弱点诊断、下一步建议、学习材料推荐、错题归因等），默认必须沉淀为**结构化、可追踪、可复用**的学习诊断数据，并进入后续学习闭环。

   规则：
   - AI 输出应优先设计为结构化 schema，包含可被系统使用的字段；不要只保存一段不可解释的自然语言。
   - 对学生有长期价值的 AI 结果应优先持久化，避免结果页、首页、错题页等每次打开时重复调用 LLM。
   - AI 结果不得成为单点依赖。LLM 失败、超时、材料不足或 schema 校验失败时，web端必须回退到确定性规则产物，保证判题、解析、复习计划和错题本不受影响。
   - AI 复盘类能力必须基于已知事实生成：学生年级/学段、目标考试、本次答题表现、知识点掌握度、错题分布、已发布学习材料等；不得编造未提供的学习历史、老师评价或材料来源。
   - 持久化后的 AI 学习诊断应可被后续模块复用，例如结果页展示、下次练习推荐、错题复习优先级、admin质量评估等。
   - web端展示 AI 结果时必须使用学生/家长可理解的语言，不展示 prompt、schema、provider、job、内部 ID、fallback、quality flag 等工程信息。
   - 新增 AI 学习能力仍必须遵守第 5 条：先在 `how-to-use-llm-proxy` 验证 prompt/schema/质量标准，再同步为 `@hao/llm` 公共入口，业务端只做接线和持久化。

7. **`max_output_tokens` / `default_params.max_tokens` 设置规则**（thinking 模型友好）：

   背景：LLM Proxy 上的 Gemini 3.x（pro / flash）是 thinking 模型——每次回答前先在内部"想"一段（计入 `usage.completion_tokens_details.reasoning_tokens`），再吐 visible content。请求里的 `max_tokens` 是**两者共享的硬预算**：

   ```
   reasoning_tokens + completion_tokens(visible) ≤ max_tokens
   ```

   `reasoning_tokens` 量级依 prompt 复杂度和 schema 嵌套深度变化（F3 questions 实测 3.5k–5.4k，KP 实测低很多）。设小了 → reasoning 把预算烧光 → visible 被切到一两百字符 → `finish_reason="length"` + 半截 JSON（历史 F3 抽题探针实测）。

   规则：
   - **未实测过真实输出上限时**，`max_output_tokens` 留 `null`，且 `default_params.max_tokens` **也不要设**，让上游用自己的默认值。
   - **实测过且需要切片决策时**，写实测得到的"reasoning + visible 总和"实测峰值的 ~1.5x；并在注释里说明这是 reasoning + visible 共享预算。
   - **绝对不要**凭"visible 看起来在某个值附近停了"反推 `max_output_tokens` —— 那个停在哪里看到的是 `reasoning + visible` 的合并结果，不是 visible 的真实上限。
   - 调用方需要切分输出时（如 F4.3 KP 分片），用业务层面的 prompt 提示和 chunk 大小控制，不要靠 `max_output_tokens`。

   非 thinking 模型（Claude Opus 4.x / GPT-4.x）不受此规则影响，但同样优先 `null`，只有撞到上限或需要切片决策时再写。

8. **UI 面向客户展示规则**：

   web端、admin端以及后续所有面向客户的 UI，默认不得直接展示数据库主键、编码 ID、Provider ID、Job ID、枚举原值、内部路径等工程化标识。界面文案必须面向使用者，优先展示客户能理解的名称、标题、状态、类型、时间、进度、来源说明和可执行动作。

   UI 设计必须先确认当前页面的使用者视角：
   - web端一定从学生/家长视角设计。页面应该告诉学生"今天练什么、为什么练、怎么开始、做完会得到什么"，不要暴露"老师还没设置"、"按全部知识点兜底"、"待生成题"、`ai_generated`、`fallback` 等系统流程、admin配置或工程状态。确需表达系统暂未个性化时，应转译成正向学习语言，例如"今天先为你安排一组基础巩固练习"。
   - admin端一定从admin人员视角设计。页面应该帮助admin人员完成导入、审核、配置、排障和发布，不要把学生学习动线文案、代码枚举、底层任务状态原样展示成主要 UI。
   - web端面向学生/家长：展示"高一数学 / 集合与常用逻辑用语 / 今日练习 / 错题复习"这类学习语言，不展示 `kp-xxx`、`question_id`、`pool=new_knowledge` 等内部字段。
   - admin端面向admin人员：展示"教材解析中 / 试题导入失败 / Claude Opus 4.7 / 已启用"这类业务语言，不直接展示 `llm_parse_job.id`、`provider_id`、`upload_id`、`question_pack` 等编码。
   - 必须提供排障信息时，放在明确的"技术详情 / 复制诊断信息"区域或开发环境专用视图中，并避免默认首屏暴露。
   - 代码中可以继续使用稳定 ID 做路由、查询、关联和日志；但渲染到 UI 前必须转换成客户可理解的 label 或摘要。
   - 题干、选项、答案、解析、知识点说明、公式、LLM 解析结果等富文本/数学文本，渲染到 UI 前必须使用统一公共格式化方法：从 `@hao/llm` 导入 `formatDisplayText` / `formatQuestionText` / `formatExamText`。不要在 admin/web 各自复制正则、临时替换 `$...$` / LaTeX 命令，或直接把原始 LLM 输出展示给用户。
   - 如果某个 UI 需要特殊格式能力，先在 `how-to-use-llm-proxy` 验证并同步更新 `packages/llm/src/display/display-text-format.ts`，再通过 `@hao/llm` 公共导出使用；不要在页面组件里私自扩展一套格式化逻辑。


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
| `worktrees/admin/`（admin端，branch=feat/admin） | `apps/admin/**` |
| `worktrees/web/`（web端，branch=feat/web） | `apps/web/**` |

## 项目状态

仓库当前处于 v0.1 MVP 启动阶段。设计文档已完整：

- `docs/PRD/SmartLearningAssistant_PRD.md` — 主 PRD v1.1
- `docs/PRD/Operator_Console_MVP_PRD.md` — admin端 MVP PRD v0.1
- `docs/PRD/Student_Web_MVP_PRD.md` — web端 MVP PRD v0.1
- `docs/Tech_Stack_MVP_v0.1.md` — 技术栈与交付计划 v0.1
- `docs/Git_Worktree_Guide.md` — 3 进程协作协议 v0.1

待代码引入后，请在此文件补充：

- 常用命令（构建、测试、运行、Lint）
- 代码架构与模块划分
- 其他项目特定约定
