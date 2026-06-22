# Web 进程 Prompt：学生一轮复习 MVP P0

请在 `worktrees/web/` 中执行本 prompt。你是web端 Claude C，只能修改 `apps/web/**`。如果发现必须修改 `packages/**`，请停止并把需要 main 处理的公共层改动写清楚，交给主目录进程处理。

## 背景

当前项目是“好好学习”高考备考 MVP。目标用户是一名高二学生，2027 年参加高考，现在处于数学第一轮复习。web端的核心体验不是展示系统能力，而是每天让学生清楚：

- 今天练什么
- 为什么练这些
- 预计要多久
- 做完哪里变强
- 明天系统还会继续补什么

请先阅读：

- `AGENTS.md`
- `.claude-role.md`
- `docs/Student_First_Round_MVP_Task_List.md`
- `docs/Student_First_Round_MVP_A1_Three_Day_Acceptance.md`
- `docs/PRD/Student_Web_MVP_PRD.md`

## 硬性边界

- 不要修改 `packages/**`、`apps/admin/**`、`docs/**`。
- 不要在web端展示数据库主键、Provider ID、Job ID、枚举原值、内部路径、`pool`、`fallback`、`ai_generated` 等工程标识。
- 题干、答案、解析、公式、LLM 输出展示必须继续使用现有公共格式化入口，不要在页面里私自写正则替换。
- 不做 AI 对话、不做多学科、不做学生上传题目、不做学生自由选题。
- 使用 TDD：先写失败测试，再实现，再跑通过。

## 当前相关文件

优先检查并复用这些文件：

- `apps/web/app/page.tsx`：首页，目前包含今日练习、进度入口、planner 设置。
- `apps/web/app/actions.ts`：登录、开始今日 session、保存 planner、提交 session。
- `apps/web/lib/today-planner.ts`：今日题组与 planner 数据。
- `apps/web/lib/planner-adapter.ts`：planner slot 到展示数据的映射。
- `apps/web/lib/planner-preferences.ts`：当前学生可见的练习设置。
- `apps/web/lib/student-data.ts`：学生当前数据、答题页、结果页数据。
- `apps/web/lib/session-submit.ts`：提交事务，已包含 mastery、spaced review、mistake book 更新。
- `apps/web/app/study/[sessionId]/result/page.tsx`：结果页。
- `apps/web/app/progress/page.tsx` 和 `apps/web/lib/progress.ts`：学习进度页。

## 本轮目标

只做第一轮 P0 学生价值闭环，不扩功能范围：

1. G2：web端文案去工程化。
2. B1：学生错题本列表。
3. B2：单题错题重做。
4. C1：首页改成“今日复习任务台”。

## Task 1：web端文案去工程化

### 要做什么

全量扫描 `apps/web/**`，把学生可见的工程词改成学习语言。特别关注首页 planner 设置、结果页、进度页、空状态、错误态。

### 验收标准

- web端不出现 `pool`、`new_knowledge`、`mistake_variant`、`spaced_review`、`fallback`、`provider`、`job` 等词。
- 不展示 `kp_id`、`question_id`、`session_id` 等内部 ID。
- 空状态使用正向学习语言。
- planner 设置如果暂时保留，必须转译为学生能理解的学习模式；如果难以转译，先从首页隐藏设置入口，不要让高二学生调权重。

### 建议测试

- 更新或新增 `apps/web/lib/planner-preferences.test.ts`，覆盖学生可见标签不包含工程词。
- 使用 `rg -n "pool|new_knowledge|mistake_variant|spaced_review|fallback|provider|job|kp_id|question_id" apps/web` 做人工复查；代码变量可存在，页面文案不能出现。

## Task 2：首页改成“今日复习任务台”

### 要做什么

改造 `apps/web/app/page.tsx`。首页首屏必须回答：

- 今天练什么：展示今日涉及的章节/知识点摘要。
- 为什么练：展示推荐原因，如“巩固新学内容”“回炉最近错题”“安排到期复习”。
- 预计多久：保留 25 分钟或根据题量显示。
- 做完看到什么：解析、错题、进度变化。

### 实现建议

- 在 `apps/web/lib/today-planner.ts` 增加面向 UI 的摘要字段，例如 `taskSummary`，但字段命名和具体实现由你结合现有类型决定。
- 复用 `planner.slots` 中已有的知识点展示信息和 pool 映射，不要把 pool 原值传到页面文案。
- 首页主按钮文案改为“开始今日复习”。
- 首页保留“学习进度”和“练习记录”入口。
- 首页增加“错题复习”入口，指向 Task 3 的错题本页面。

### 验收标准

- 首页显示“今日一轮复习”或等价学习语言。
- 首页展示今日推荐的知识点/章节摘要。
- 首页展示推荐原因。
- 首页主按钮是学生动作语言，不是系统状态语言。
- 题量不足时显示正向文案，不暴露“题库不足”。

### 建议测试

- 给 `today-planner` 的摘要逻辑加单测。
- 至少覆盖：
  - 有错题时显示错题巩固原因。
  - 有到期复习时显示复习回顾原因。
  - 只有新题时显示基础巩固原因。
  - 没有足够题目时仍显示正向文案。

## Task 3：学生错题本列表

### 要做什么

新增web端错题本页面。建议路径为 `/study/mistakes` 或 `/mistakes`，优先选择和现有 `/study/history` 风格一致的路径。页面按知识点分组展示当前学生 `open` 错题。

### 数据要求

只展示当前学生自己的 `mistake_book_entry.status = open`，并且题目的 `primary_kp_id` 必须在 `student.unlocked_kp_ids` 内。

每条错题展示：

- 知识点名称
- 题干摘要
- 最近更新时间或最近错误时间
- 累计错误次数
- “重做这题”入口

### 验收标准

- 首页有“错题复习”入口。
- 错题本只展示当前学生自己的 open 错题。
- 错题按知识点分组。
- 无错题时显示正向空状态。
- 不展示 `mistake_book_entry`、`question_id`、`kp_id`。

### 建议文件

- 新增 `apps/web/lib/mistake-book.ts`
- 新增 `apps/web/lib/mistake-book.test.ts`
- 新增 `apps/web/app/study/mistakes/page.tsx`

## Task 4：单题错题重做

### 要做什么

学生从错题本点击“重做这题”，进入单题重做页。提交后立即批改，并更新错题状态：

- 答错：保持 open，`error_count += 1`，`consecutive_correct_count = 0`。
- 答对：`consecutive_correct_count += 1`，达到 2 后标记 resolved。

现有 `apps/web/lib/session-submit.ts` 已有类似逻辑。优先抽取或复用同一套规则，避免出现今日 session 和错题重做两套不同状态机。

### 验收标准

- 学生只能重做自己的 open 错题。
- 未解锁知识点下的错题不能访问。
- 提交后立即显示对错、正确答案、解析。
- 连续两次答对后，该错题从错题本消失。
- 答错后仍留在错题本。

### 建议文件

- 新增或修改 `apps/web/lib/mistake-redo.ts`
- 新增 `apps/web/lib/mistake-redo.test.ts`
- 新增 `apps/web/app/study/mistakes/[questionId]/page.tsx`
- 新增 `apps/web/app/study/mistakes/[questionId]/actions.ts`

如果使用 `[questionId]` 会让 URL 暴露 UUID，不要在页面正文显示它；如果你认为路由也不应暴露内部 ID，请使用不可猜测的 session-like token，但不要为此扩大范围。

## Task 5：结果页显示错题消解提示

### 要做什么

在今日 session 结果页中，如果本次提交导致某道历史错题 resolved，展示学生能理解的提示，例如“这道错题已攻克，已从错题复习中移除”。

### 验收标准

- 本次攻克错题数量可见。
- 对应题目卡片有清晰提示。
- 没有攻克错题时不显示空洞模块。

如果实现 Task 5 需要改动公共事务返回结构且超出 `apps/web/**`，请先暂停，向 main 进程提出所需公共层改动。

## 验证命令

在 `worktrees/web/` 执行：

```bash
pnpm --filter @hao/web typecheck
pnpm --filter @hao/web lint
pnpm --filter @hao/web test
```

然后在仓库主目录或当前 worktree 视情况执行全量：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

如果 `pnpm test` 因沙箱 IPC pipe 报 `EPERM`，按当前协作规则请求非沙箱执行，不要跳过测试。

## 完成后汇报

请汇报：

- 改了哪些学生旅程。
- 新增了哪些页面/测试。
- 哪些验收标准已通过。
- 是否有需要 main 进程处理的 `packages/**` 公共层改动。
