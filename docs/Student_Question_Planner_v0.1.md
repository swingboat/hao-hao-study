# web端出题 Planner 设计 v0.1

> 记录日期：2026-06-16
> 适用范围：web端第一版学习 Session 规划。
> 核心原则：Planner 负责学习策略与题位分配，AI 只在单个题位内生成题目，不参与全局调度。

## 1. 目标

学生点击"开始今日学习"后，系统需要同时考虑多个学习需求：

1. 按教材进度学习：基于当前章节及其知识点出题。
2. 错题修复：基于学生错题生成原题重做或变式题。
3. 艾宾浩斯复习：基于到期的 `spaced_review` 知识点出题。
4. 费曼验证：基于知识点生成复述任务，判断学生是否真正理解。

第一版设计支持这些需求共同出现。Planner 将它们合并成一组可执行的 `LearningSlot`，再由题库或 AI 逐个满足。

## 2. 边界

Planner 不生成题目正文，不判断答案，不调用 LLM。

Planner 只做：

- 读取学生、知识点、错题、复习、掌握度和题库状态。
- 生成候选学习任务。
- 根据模式、权重、预算和去重规则装配 Session 题位。
- 决定每个题位优先使用题库还是 AI 生成。

AI 只做：

- 对 `ai_generated` 题位生成一道符合约束的题。
- 对 `feynman_check` 题位生成复述提示和评分要点。

新的 AI prompt、schema、验题逻辑必须先在 `how-to-use-llm-proxy` 验证稳定，再同步到 `@hao/llm`；当前仓库只接入稳定公共方法。

## 3. 输入

```ts
type PlannerMode = 'daily_mixed' | 'chapter_focus' | 'mistake_focus';

type PlannerRequest = {
  studentId: string;
  mode?: PlannerMode; // 默认 daily_mixed
  count?: number; // 默认 8，最大 15
  chapterNo?: string; // 指定教材章节，如 "2.1"
  kpIds?: string[]; // 可选知识点范围，会和 unlocked_kp_ids 取交集
  sourceQuestionIds?: string[]; // 可选母题 / 错题来源
  difficulty?: number | [number, number];
  questionTypes?: ('choice' | 'fill_in')[];
};
```

系统自动补齐：

- `subjectId = student.primary_subject_id`
- `targetExam = student.target_exam`，例如 `高考 2027`
- `allowedKpIds = request.kpIds ∩ student.unlocked_kp_ids`；若未传 `kpIds`，则取 `student.unlocked_kp_ids`
- `questionTypes = ['choice', 'fill_in']`

`allowedKpIds` 是硬边界。任何 Planner、题库、AI 生成结果都不能突破该范围。

## 4. 输出

```ts
type LearningSlot =
  | BankQuestionSlot
  | AiQuestionSlot
  | FeynmanPromptSlot;

type SlotPool =
  | 'chapter_practice'
  | 'mistake_variant'
  | 'spaced_review'
  | 'feynman_check'
  | 'new_knowledge';

type BaseSlot = {
  slotId: string;
  pool: SlotPool;
  kpId: string;
  targetExam: string;
  reason: string;
  secondaryReasons?: SlotPool[];
};

type BankQuestionSlot = BaseSlot & {
  source: 'question_bank';
  questionId: string;
};

type AiQuestionSlot = BaseSlot & {
  source: 'ai_generated';
  difficultyRange: [number, number];
  questionType: 'choice' | 'fill_in';
  sourceQuestionId?: string;
  fallback: 'retry_then_question_bank' | 'drop_slot';
};

type FeynmanPromptSlot = BaseSlot & {
  source: 'ai_generated';
  activityType: 'feynman_prompt';
  fallback: 'drop_slot';
};
```

前三类需求最终产生 `choice` / `fill_in` 题。费曼验证产生复述任务，不应直接写入当前 `question` 表，因为当前 DB 只支持 `choice` / `fill_in`。

## 5. 候选池

### 5.1 `chapter_practice`

用于按教材进度学习。

来源：

- `knowledge_point.chapter_no = request.chapterNo`
- 或当前已解锁且尚未掌握的章节知识点

过滤：

- `kp_id ∈ allowedKpIds`
- mastery 缺失按 `0` 处理

用途：

- 推进当前章节。
- 题库有合适题则优先题库；题库不足时可 AI 生成。

### 5.2 `new_knowledge`

用于泛化的新知识点练习，是 `chapter_practice` 的兜底池。

来源：

- `kp_id ∈ allowedKpIds`
- `mastery_score < 0.5`
- 没有 mastery 记录视为 `0`

用途：

- 冷启动阶段的主要出题来源。
- 第一版web端若还没有章节进度字段，可先用 `new_knowledge` 替代 `chapter_practice`。

### 5.3 `mistake_variant`

用于错题修复。

来源：

- `mistake_book_entry.status = 'open'`
- 对应 `question.primary_kp_id ∈ allowedKpIds`
- 可带 `sourceQuestionId`

用途：

- 优先使用原错题重做。
- 题库不足或需要变式时，AI 根据原题、答案、解析、学生错误答案生成变式题。

### 5.4 `spaced_review`

用于艾宾浩斯复习。

来源：

- `spaced_review.next_review_at <= now()`
- `kp_id ∈ allowedKpIds`

用途：

- 到期知识点优先复习。
- 难度不宜过高，优先基础或标准题。

### 5.5 `feynman_check`

用于验证是否真正理解。

来源：

- `mastery_score >= 0.5 && mastery_score < 0.85`
- 或最近连续答对、但尚未做过表达验证的知识点

用途：

- 生成复述提示，而不是普通可判分题。
- 第一版可只规划，不落地答题链路；实现时需要独立 activity 或扩展 DB。

## 6. 模式与配比

第一版固定三种模式。

### 6.1 `daily_mixed`

首页"开始今日学习"默认模式。

```ts
{
  chapter_practice: 0.4,
  mistake_variant: 0.3,
  spaced_review: 0.3,
  feynman_check: { maxCount: 1 }
}
```

示例：8 个 slot 时，优先装配为：

- `chapter_practice` / `new_knowledge`：3-4 个
- `mistake_variant`：2 个
- `spaced_review`：2 个
- `feynman_check`：最多 1 个

### 6.2 `chapter_focus`

学生选择"学当前章节"时使用。

```ts
{
  chapter_practice: 0.7,
  spaced_review: 0.2,
  mistake_variant: 0.1,
  feynman_check: { maxCount: 1 }
}
```

### 6.3 `mistake_focus`

学生选择"错题专项"时使用。

```ts
{
  mistake_variant: 0.7,
  spaced_review: 0.2,
  chapter_practice: 0.1,
  feynman_check: { maxCount: 0 }
}
```

## 7. 装配规则

1. 先构建所有候选池。
2. 按模式计算每个池的目标数量。
3. 对候选打分：
   - `spaced_review`：到期越久分越高。
   - `mistake_variant`：`error_count` 越高分越高。
   - `chapter_practice` / `new_knowledge`：mastery 越低分越高；同章节按章节顺序。
   - `feynman_check`：mastery 在 `[0.5, 0.85)` 且近期答对越多，分越高。
4. 每个 `primary_kp_id` 本次 Session 默认最多出现 1 次。
5. 若某池候选不足，将剩余 slot 按优先级回填：
   `spaced_review > mistake_variant > chapter_practice > new_knowledge > feynman_check`
6. 若总 slot 少于最低阈值，不创建 Session，返回空数据态。

第一版最低阈值建议为 3；正式学习 Session 目标为 8，最大 15。

## 8. 多需求命中同一 KP

第一版采用最高优先级去重。

优先级：

```text
spaced_review > mistake_variant > chapter_practice > new_knowledge > feynman_check
```

例如同一个 KP 同时命中当前章节、错题、到期复习，则保留 `spaced_review` slot。

第二版可升级为复合 slot：

```ts
{
  pool: 'spaced_review',
  secondaryReasons: ['mistake_variant', 'chapter_practice']
}
```

复合 slot 可让 AI 生成更贴合场景的题，例如"复习到期 + 最近错过 + 当前章节重点"。但第一版先不做，避免复杂度过高。

## 9. 难度规则

默认按 mastery 推导：

| mastery 区间 | 难度范围 |
|---|---|
| `[0, 0.2)` | `[1, 2]` |
| `[0.2, 0.5)` | `[2, 3]` |
| `[0.5, 0.85)` | `[3, 4]` |
| `[0.85, 1]` | 不进入新题池 |

若请求指定 `difficulty`，则与默认难度取交集。若交集为空，优先保留用户指定难度，但 slot reason 必须记录该覆盖。

## 10. AI 生成与 Validator

AI 只在 slot 级别工作：

- `AiQuestionSlot`：生成一道 `choice` 或 `fill_in`。
- `FeynmanPromptSlot`：生成复述 prompt、期望要点和评分 rubrics。

AI 输出必须经过自动 Validator：

1. Schema 合法。
2. `primary_kp_id ∈ allowedKpIds`。
3. `kp_ids` 均存在于 DB。
4. `question_type` 在允许范围。
5. `difficulty` 在 slot 范围。
6. `answer`、`solution_text` 非空。
7. 可选：solver check 验证答案和解析一致。

学生实时链路不走人工 review。Validator 不通过时：

1. 重试一次。
2. 仍失败则回退题库相近题。
3. 还失败则删除该 slot。

## 11. 第一版实现建议

第一版web端可以先实现 Planner 的最小子集：

1. `daily_mixed` 模式。
2. `new_knowledge` / `chapter_practice` 题库取题。
3. `mistake_variant` 和 `spaced_review` 的数据结构预留，可先不接 AI。
4. `feynman_check` 只写入设计，不进第一轮web端答题闭环。
5. 题库不足时先显示空数据态，不实时调用 AI。

等题库 Session 闭环稳定后，再接入 AI 生成和 Validator。
