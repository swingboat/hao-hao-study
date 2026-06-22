# 学习资料资产化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把教材、辅导讲义、题集、答案解析册、完整试卷等上传文件，稳定沉淀为可审核、可追溯、可在web端使用的知识点、题目、学习材料和来源资产。

**Architecture:** 采用“文档画像识别 -> 分块分类 -> 按类型解析 -> 人工审核 -> 发布使用”的分层架构。新的 prompt、schema 和 LLM 解析策略先在 `how-to-use-llm-proxy` 验证；当前仓库只接入已验证的公共方法，并负责 DB、共享 schema、admin审核和web端展示。

**Tech Stack:** Prisma/PostgreSQL、`@hao/shared` zod schema、`@hao/llm` adapter、`@hao/storage` ObjectStore、BullMQ、Next.js admin/web、`how-to-use-llm-proxy` 公共解析层。

---

## 1. 背景与问题

当前 MVP 已经有两条解析主线：

- `analyzeKnowledgePoints()`：从教材或资料中提取知识点。
- `analyzeQuestions()`：从题集、试卷或习题资料中提取题目。

这能覆盖“知识点 + 题目”的基础题库建设，但不能完整承接用户上传资料中的学习价值。典型例子是高途《集合与逻辑重点题型全梳理》PDF：它既有知识讲解，也有例题、手写解析、大招、易错提醒、题型总结和考情分析。

本计划解决 4 个具体问题：

1. 辅导教材里的大招、解题技巧、试题总结，沉淀为“学习材料”并挂到知识点。
2. 有详细解题过程和总结的试题，既作为题目入库，也把解析中的方法提炼为学习材料。
3. 只有题目、没有答案和解析的试题，进入候选区和补全队列，不直接发布给学生正式练习。
4. 完整试卷如“2026 年高考卷 1 数学”，沉淀为结构化来源，支持以后按名称、年份、试卷类型查询。

## 2. 范围边界

### 本仓库主目录 A 可做

- `packages/db/**`：新增来源资产、学习材料、题目来源关系的数据模型。
- `packages/shared/**`：新增文档画像、来源、学习材料、混合解析结果的 zod schema。
- `packages/llm/**`：在 `how-to-use-llm-proxy` 验证通过后，同步并暴露新的公共解析入口。
- `docs/**`：维护 PRD、技术计划、验收清单和跨 worktree 实施说明。
- `scripts/**`：必要时增加迁移、同步或验收脚本。

### admin worktree B 可做

- `apps/admin/**`：上传时的文档画像展示、来源审核、学习材料审核、混合解析结果审核、缺答案题目处理。

### web worktree C 可做

- `apps/web/**`：知识点详情、今日复习、错题解析、来源展示中的学习材料消费。

### 不在当前仓库直接做

- 新的 LLM prompt、schema、切片策略、视觉解析策略，不在当前仓库临时研发。
- 先在 `how-to-use-llm-proxy` 使用真实样例验证，形成稳定公共方法后，再同步到 `packages/llm/src/business|documents|llm|types|display`。

## 3. 目标数据资产

### 3.1 SourceDocument：资料来源

用途：表示“这份上传资料是什么”，支持以后查询“2026 年高考卷 1 数学”“高途 2024 秋季第 1 讲”。

同时需要调整现有解析枚举：

```prisma
enum ParseTaskKind {
  question
  knowledge_point
  goal_template
  mixed_learning_material
}

enum ParseEntityKind {
  question
  knowledge_point
  goal_template
  source_document
  learning_material
}

enum UploadFileType {
  exam_outline
  textbook
  question_pack
  lesson_handout
  workbook
  exam_paper
  answer_book
  mixed_material
}
```

`content_upload.purpose` 和 `llm_parse_job.task_kind` 继续使用 `ParseTaskKind`；`llm_parse_staging.entity_kind` 改用 `ParseEntityKind`，避免一个混合解析任务无法产出多种审核实体。

建议字段：

```prisma
enum SourceDocumentType {
  textbook
  lesson_handout
  workbook
  question_pack
  exam_paper
  answer_book
  mixed_material
}

model source_document {
  id             String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  upload_id      String             @db.Uuid
  upload         content_upload     @relation(fields: [upload_id], references: [id], onDelete: Cascade)
  source_type    SourceDocumentType
  title          String
  subject_id     String
  subject        subject            @relation(fields: [subject_id], references: [id])
  stage          Stage?
  grade          Grade?
  provider       String?
  publisher      String?
  year           Int?
  season         String?
  exam_name      String?
  paper_name     String?
  region         String?
  lesson_no      String?
  page_count     Int?
  metadata       Json               @default("{}")
  created_at     DateTime           @default(now()) @db.Timestamptz()

  units          source_unit[]
  question_links question_source[]
  materials      learning_material[]

  @@index([subject_id, source_type, year])
  @@index([title])
  @@map("source_document")
}
```

### 3.2 SourceUnit：来源定位

用途：表示每条抽取结果来自原 PDF 的哪一页、哪个 slide、哪个题号或哪个视觉区域，支持人工审核和web端“来源”展示。

```prisma
enum SourceUnitKind {
  page
  slide
  question_region
  explanation_region
  text_block
}

model source_unit {
  id                 String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  source_document_id String             @db.Uuid
  source_document    source_document    @relation(fields: [source_document_id], references: [id], onDelete: Cascade)
  unit_kind          SourceUnitKind
  page_no            Int?
  slide_no           Int?
  question_no        String?
  bbox               Json?
  text_snippet       String?
  derived_asset_key  String?
  created_at         DateTime           @default(now()) @db.Timestamptz()

  learning_materials learning_material[]
  question_links     question_source[]

  @@index([source_document_id, page_no])
  @@index([source_document_id, question_no])
  @@map("source_unit")
}
```

### 3.3 LearningMaterial：学习材料

用途：承接“大招、技巧、易错、题型总结、考情分析、教材深挖、解析总结”等学生真正需要复习的内容。

```prisma
enum LearningMaterialType {
  concept_explanation
  method_card
  common_mistake
  question_type_summary
  exam_trend
  textbook_deep_dive
  solution_summary
  study_advice
}

model learning_material {
  id                 String               @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  material_type      LearningMaterialType
  title              String
  content            String
  student_summary    String?
  subject_id         String
  subject            subject              @relation(fields: [subject_id], references: [id])
  kp_ids             String[]             @db.Uuid
  primary_kp_id      String?              @db.Uuid
  source_document_id String?              @db.Uuid
  source_document    source_document?     @relation(fields: [source_document_id], references: [id], onDelete: SetNull)
  source_unit_id     String?              @db.Uuid
  source_unit        source_unit?         @relation(fields: [source_unit_id], references: [id], onDelete: SetNull)
  confidence         Float?
  created_at         DateTime             @default(now()) @db.Timestamptz()

  @@index([subject_id, material_type])
  @@index([primary_kp_id])
  @@map("learning_material")
}
```

### 3.4 QuestionSource：题目来源关系

用途：把正式题库里的题目关联到“2026 年高考卷 1 数学 第 8 题”或“高途第 1 讲 slide 12”。

```prisma
model question_source {
  question_id        String          @db.Uuid
  question           question        @relation(fields: [question_id], references: [id], onDelete: Cascade)
  source_document_id String          @db.Uuid
  source_document    source_document @relation(fields: [source_document_id], references: [id], onDelete: Cascade)
  source_unit_id     String?         @db.Uuid
  source_unit        source_unit?    @relation(fields: [source_unit_id], references: [id], onDelete: SetNull)
  question_no        String?
  page_no            Int?
  role               String          @default("origin")
  created_at         DateTime        @default(now()) @db.Timestamptz()

  @@id([question_id, source_document_id, role])
  @@index([source_document_id, question_no])
  @@map("question_source")
}
```

## 4. 解析策略

### 4.1 文档画像

上传后第一步不直接提知识点或题目，而是生成文档画像。

目标输出：

```json
{
  "document_type": "lesson_handout",
  "subject": "高中数学",
  "stage": "senior",
  "grade": "g10",
  "layout": "4_slides_per_page",
  "has_knowledge_explanation": true,
  "has_method_summary": true,
  "has_questions": true,
  "has_answers": true,
  "has_detailed_solutions": true,
  "recommended_pipeline": "mixed_learning_material",
  "confidence": 0.88
}
```

### 4.2 分块分类

按文档画像决定分块方式：

| 文档类型 | 分块方式 |
|---|---|
| 教材 | 章节、小节、页码 |
| 辅导 PPT / 讲义 | page + slide + 视觉区域 |
| 题集 | 页码 + 题号 |
| 完整试卷 | 大题区块 + 小题题号 |
| 答案解析册 | 题号 + 答案/解析区块 |
| 混合资料 | 先 page/slide 分块，再按内容分类 |

### 4.3 解析结果类型

混合资料解析不再只输出 `knowledge_points` 或 `questions`，而是输出：

```json
{
  "source_document": {},
  "source_units": [],
  "knowledge_points": [],
  "learning_materials": [],
  "questions": []
}
```

### 4.4 缺答案题目策略

题目结果增加质量状态，不允许缺答案题直接发布：

```ts
type QuestionQualityStatus =
  | 'publishable'
  | 'missing_answer'
  | 'missing_solution'
  | 'incomplete_stem'
  | 'needs_human_review';
```

发布规则：

- `publishable`：题干、题型、答案、知识点齐全，可审核后发布。
- `missing_solution`：可以作为低风险题进入审核，但web端解析为空时要有admin确认。
- `missing_answer`：不能发布给学生正式练习。
- `incomplete_stem`：保留原始定位，不入题库。
- `needs_human_review`：admin确认后才可发布。

## 5. 分阶段实施计划

### Task 1: 需求与 PRD 对齐

**Files:**
- Modify: `docs/PRD/Operator_Console_MVP_PRD.md`
- Modify: `docs/PRD/Student_Web_MVP_PRD.md`
- Modify: `docs/Tech_Stack_MVP_v0.1.md`
- Reference: `docs/File_Storage_v0.1.md`

- [ ] **Step 1: 在admin端 PRD 增加“辅导资料资产化”章节**

写入内容要覆盖：

```markdown
### 辅导资料资产化

上传资料先进入文档画像识别，系统判断其为教材、辅导讲义、题集、答案解析册、完整试卷或混合资料。

系统将资料拆成四类可审核资产：

- 来源资产：资料标题、年份、机构、试卷名、讲次、页数。
- 知识点资产：教材或讲义中抽出的知识点候选。
- 题目资产：选择题、填空题及其答案、解析和知识点关联。
- 学习材料资产：大招、技巧、易错提醒、题型总结、考情分析、教材深挖和解析总结。

缺答案题目不得直接发布到web端正式练习；有答案但缺解析的题目必须在审核界面明确标记。
```

- [ ] **Step 2: 在web端 PRD 增加学习材料消费场景**

写入内容要覆盖：

```markdown
web端在知识点详情、今日练习准备页、答题结果页和错题详情页展示学习材料。

展示语言必须面向学生：

- “这类题怎么做”
- “常见失误”
- “本题方法”
- “下次遇到怎么判断”

不得展示 `source_document_id`、`source_unit_id`、`material_type`、`provider_id`、`parse_job_id` 等内部字段。
```

- [ ] **Step 3: 在技术栈文档记录 LLM 边界**

写入内容要覆盖：

```markdown
混合学习资料解析能力必须先在 how-to-use-llm-proxy 验证，当前项目只同步稳定公共方法。

当前项目不得在 admin/web 中新增私有 prompt、PDF 渲染循环或 LLM schema 试验。
```

- [ ] **Step 4: 提交文档对齐**

Run:

```bash
pnpm lint
git add docs/PRD/Operator_Console_MVP_PRD.md docs/PRD/Student_Web_MVP_PRD.md docs/Tech_Stack_MVP_v0.1.md
git commit -m "docs: define learning material ingestion scope"
```

Expected: `pnpm lint` 通过，提交只包含 docs 改动。

### Task 2: 公共数据模型

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/package.json`
- Test: `packages/db/src/learning-material-source.test.ts`

- [ ] **Step 1: 写 DB 关系测试**

Create `packages/db/src/learning-material-source.test.ts`:

```ts
import assert from 'node:assert/strict';

const sourceLookupFields = [
  'source_type',
  'title',
  'subject_id',
  'year',
  'exam_name',
  'paper_name',
  'lesson_no',
];

assert.equal(sourceLookupFields.includes('title'), true);
assert.equal(sourceLookupFields.includes('paper_name'), true);
assert.equal(sourceLookupFields.includes('lesson_no'), true);
```

- [ ] **Step 2: 更新 DB 测试脚本**

Modify `packages/db/package.json`:

```json
{
  "scripts": {
    "test": "tsx prisma/demo-student-password.test.ts && tsx src/textbook-scope.test.ts && tsx src/learning-material-source.test.ts"
  }
}
```

- [ ] **Step 3: 运行测试确认新测试被执行**

Run:

```bash
pnpm --filter @hao/db test
```

Expected: 命令执行 `src/learning-material-source.test.ts`，测试通过。

- [ ] **Step 4: 增加 Prisma enum 和 model**

在 `packages/db/prisma/schema.prisma` 调整现有 enum：

```prisma
enum ParseTaskKind {
  question
  knowledge_point
  goal_template
  mixed_learning_material
}

enum ParseEntityKind {
  question
  knowledge_point
  goal_template
  source_document
  learning_material
}

enum UploadFileType {
  exam_outline
  textbook
  question_pack
  lesson_handout
  workbook
  exam_paper
  answer_book
  mixed_material
}
```

并将 `llm_parse_staging.entity_kind` 从 `ParseTaskKind` 改为 `ParseEntityKind`：

```prisma
model llm_parse_staging {
  entity_kind ParseEntityKind
}
```

然后增加：

```prisma
enum SourceDocumentType {
  textbook
  lesson_handout
  workbook
  question_pack
  exam_paper
  answer_book
  mixed_material
}

enum SourceUnitKind {
  page
  slide
  question_region
  explanation_region
  text_block
}

enum LearningMaterialType {
  concept_explanation
  method_card
  common_mistake
  question_type_summary
  exam_trend
  textbook_deep_dive
  solution_summary
  study_advice
}
```

并加入 `source_document`、`source_unit`、`learning_material`、`question_source` 四个 model。字段以本计划第 3 节为准。

- [ ] **Step 5: 为反向关系补齐字段**

需要在现有 model 上补关系字段：

```prisma
model subject {
  source_documents  source_document[]
  learning_materials learning_material[]
}

model content_upload {
  source_documents source_document[]
}

model question {
  sources question_source[]
}
```

- [ ] **Step 6: 格式化和校验 schema**

Run:

```bash
pnpm --filter @hao/db exec prisma format
pnpm typecheck
```

Expected: Prisma format 成功，TypeScript 类型检查通过。

- [ ] **Step 7: 提交数据模型**

Run:

```bash
git add packages/db/prisma/schema.prisma packages/db/package.json packages/db/src/learning-material-source.test.ts
git commit -m "feat(db): add learning material source models"
```

### Task 3: 共享 schema 契约

**Files:**
- Create: `packages/shared/src/schemas/source-document.ts`
- Create: `packages/shared/src/schemas/source-unit.ts`
- Create: `packages/shared/src/schemas/learning-material.ts`
- Create: `packages/shared/src/schemas/mixed-learning-material.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/schemas/learning-material.test.ts`
- Test: `packages/shared/src/schemas/mixed-learning-material.test.ts`

- [ ] **Step 1: 写 learning material schema 测试**

Create `packages/shared/src/schemas/learning-material.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LearningMaterialParsedSchema } from './learning-material';

describe('LearningMaterialParsedSchema', () => {
  it('accepts a method card with kp hints and source ref', () => {
    const parsed = LearningMaterialParsedSchema.safeParse({
      material_type: 'method_card',
      title: '利用子集关系求参',
      content: 'A ∪ B = B 等价于 A ⊆ B，可转化为端点范围讨论。',
      student_summary: '遇到并集等于其中一个集合时，先转成包含关系。',
      kp_hints: ['集合的运算', '集合中的求参问题'],
      source_ref: { page: 10, slide_no: 39, question_no: null },
      confidence: 0.92,
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects internal ids in parsed payload', () => {
    const parsed = LearningMaterialParsedSchema.safeParse({
      material_type: 'method_card',
      title: '错误示例',
      content: '不应包含内部主键。',
      student_summary: '不应包含内部主键。',
      kp_hints: ['集合的运算'],
      source_document_id: '00000000-0000-0000-0000-000000000000',
    });

    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: 实现 learning material schema**

Create `packages/shared/src/schemas/learning-material.ts`:

```ts
import { z } from 'zod';

export const LearningMaterialTypeSchema = z.enum([
  'concept_explanation',
  'method_card',
  'common_mistake',
  'question_type_summary',
  'exam_trend',
  'textbook_deep_dive',
  'solution_summary',
  'study_advice',
]);

export const SourceRefSchema = z.object({
  page: z.number().int().positive().nullable().optional(),
  slide_no: z.number().int().positive().nullable().optional(),
  question_no: z.string().max(30).nullable().optional(),
  text_snippet: z.string().max(300).nullable().optional(),
});

export const LearningMaterialParsedSchema = z
  .object({
    material_type: LearningMaterialTypeSchema,
    title: z.string().min(2).max(80),
    content: z.string().min(10).max(3000),
    student_summary: z.string().min(5).max(500).optional(),
    kp_hints: z.array(z.string().min(2).max(50)).min(1).max(8),
    source_ref: SourceRefSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export type LearningMaterialParsed = z.infer<typeof LearningMaterialParsedSchema>;

export const LearningMaterialBatchSchema = z.object({
  items: z.array(LearningMaterialParsedSchema).max(300),
});

export type LearningMaterialBatch = z.infer<typeof LearningMaterialBatchSchema>;
```

- [ ] **Step 3: 实现 source document 与 source unit schema**

Create `packages/shared/src/schemas/source-document.ts`:

```ts
import { z } from 'zod';

export const SourceDocumentTypeSchema = z.enum([
  'textbook',
  'lesson_handout',
  'workbook',
  'question_pack',
  'exam_paper',
  'answer_book',
  'mixed_material',
]);

export const SourceDocumentParsedSchema = z
  .object({
    source_type: SourceDocumentTypeSchema,
    title: z.string().min(2).max(120),
    subject_name: z.string().min(2).max(30),
    provider: z.string().max(60).optional(),
    publisher: z.string().max(60).optional(),
    year: z.number().int().min(1900).max(2100).optional(),
    season: z.string().max(20).optional(),
    exam_name: z.string().max(40).optional(),
    paper_name: z.string().max(60).optional(),
    region: z.string().max(40).optional(),
    lesson_no: z.string().max(30).optional(),
    page_count: z.number().int().positive().optional(),
  })
  .strict();

export type SourceDocumentParsed = z.infer<typeof SourceDocumentParsedSchema>;
```

Create `packages/shared/src/schemas/source-unit.ts`:

```ts
import { z } from 'zod';

export const SourceUnitKindSchema = z.enum([
  'page',
  'slide',
  'question_region',
  'explanation_region',
  'text_block',
]);

export const SourceUnitParsedSchema = z
  .object({
    unit_kind: SourceUnitKindSchema,
    page_no: z.number().int().positive().nullable().optional(),
    slide_no: z.number().int().positive().nullable().optional(),
    question_no: z.string().max(30).nullable().optional(),
    bbox: z.array(z.number()).length(4).nullable().optional(),
    text_snippet: z.string().max(300).nullable().optional(),
  })
  .strict();

export type SourceUnitParsed = z.infer<typeof SourceUnitParsedSchema>;
```

- [ ] **Step 4: 写 mixed schema 测试**

Create `packages/shared/src/schemas/mixed-learning-material.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MixedLearningMaterialBatchSchema } from './mixed-learning-material';

describe('MixedLearningMaterialBatchSchema', () => {
  it('accepts source, materials, and questions in one parsed result', () => {
    const parsed = MixedLearningMaterialBatchSchema.safeParse({
      source_document: {
        source_type: 'lesson_handout',
        title: '第1讲 集合与逻辑重点题型全梳理',
        subject_name: '高中数学',
        provider: '高途',
        year: 2024,
        season: '秋季',
        lesson_no: '第1讲',
        page_count: 20,
      },
      learning_materials: [
        {
          material_type: 'common_mistake',
          title: '含参问题回代检验',
          content: '含参集合问题求出参数后，需要回代检查元素互异性。',
          kp_hints: ['集合中元素的互异性'],
          confidence: 0.9,
        },
      ],
      questions: [],
      knowledge_points: [],
    });

    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 5: 实现 mixed schema**

Create `packages/shared/src/schemas/mixed-learning-material.ts`:

```ts
import { z } from 'zod';
import { KnowledgePointParsedSchema } from './knowledge-point';
import { LearningMaterialParsedSchema } from './learning-material';
import { QuestionParsedSchema } from './question';
import { SourceDocumentParsedSchema } from './source-document';
import { SourceUnitParsedSchema } from './source-unit';

export const MixedLearningMaterialBatchSchema = z
  .object({
    source_document: SourceDocumentParsedSchema,
    source_units: z.array(SourceUnitParsedSchema).max(1000).default([]),
    knowledge_points: z.array(KnowledgePointParsedSchema).max(500).default([]),
    learning_materials: z.array(LearningMaterialParsedSchema).max(300).default([]),
    questions: z.array(QuestionParsedSchema).max(300).default([]),
  })
  .strict();

export type MixedLearningMaterialBatch = z.infer<typeof MixedLearningMaterialBatchSchema>;
```

- [ ] **Step 6: 导出 schema**

Modify `packages/shared/src/schemas/index.ts` and `packages/shared/src/index.ts`:

```ts
export * from './learning-material';
export * from './mixed-learning-material';
export * from './source-document';
export * from './source-unit';
```

- [ ] **Step 7: 运行测试**

Run:

```bash
pnpm --filter @hao/shared test
pnpm typecheck
```

Expected: 新增 schema 测试通过，类型检查通过。

- [ ] **Step 8: 提交共享 schema**

Run:

```bash
git add packages/shared/src
git commit -m "feat(shared): add learning material schemas"
```

### Task 4: LLM Proxy 验证任务

**Files:**
- Create: `docs/prompts/mixed-learning-material-proxy-requirements.md`
- Reference sample: 高途《集合与逻辑重点题型全梳理》PDF
- External implementation: `how-to-use-llm-proxy`

- [ ] **Step 1: 写代理项目需求文档**

Create `docs/prompts/mixed-learning-material-proxy-requirements.md` with:

```markdown
# 混合学习资料解析公共方法需求

## 输入

- PDF、Word 或图片资料。
- 学科上下文，例如“高中数学”。
- 可选知识点上下文，用于 kp_hints 归一化。

## 输出

- source_document
- knowledge_points
- learning_materials
- questions

## 关键规则

- 每条结果必须带 source_ref。
- 原文没有答案时，不得生成答案。
- 原文没有解析时，solution_text 使用空字符串。
- 学习材料必须区分 method_card、common_mistake、question_type_summary、exam_trend、solution_summary。
- 对图片化 PPT，先按 page/slide 分块。
- 对完整试卷，必须提取 exam_year、exam_name、paper_name、question_no。

## 验收样例

- 高途 2024 秋季高一数学第 1 讲：应识别为 lesson_handout，提取集合相关方法卡和例题。
- 2026 年高考卷 1 数学：应识别为 exam_paper，提取 source_document 和题号来源。
```

- [ ] **Step 2: 在 how-to-use-llm-proxy 中验证公共方法**

在外部项目中验证以下公共方法形态：

```ts
analyzeMixedLearningMaterial({
  file,
  subjectName,
  knowledge,
  llmTarget,
  apiKey,
}): Promise<MixedLearningMaterialBatch>
```

同步回当前仓库后的公共层必须保持以下导出名称，避免 adapter 执行时再猜接口：

```ts
// packages/llm/src/business/education-analysis.ts
export async function analyzeMixedLearningMaterial(opts: Record<string, unknown>): Promise<unknown>;

// packages/llm/src/types/public-types.ts
export interface MixedLearningMaterialAnalysisResult {
  kind: 'mixed_learning_material';
  status: 'ok' | 'partial' | 'failed';
  source: {
    type: string;
    name: string;
    page_count?: number;
  };
  source_document: Record<string, unknown>;
  knowledge_points: unknown[];
  learning_materials: unknown[];
  questions: unknown[];
  diagnostics?: Record<string, unknown>;
}
```

验收要求：

- 高途 PPT PDF 能提取 `source_document.source_type="lesson_handout"`。
- 至少提取 8 条 `learning_materials`，包含 `method_card`、`common_mistake`、`question_type_summary`。
- 有解析的例题输出 `solution_text`。
- 缺答案题不输出编造答案。
- 完整试卷样例能输出 `exam_name`、`paper_name`、`year` 和题号。

- [ ] **Step 3: 同步公共层到当前仓库**

同步范围限定：

```text
packages/llm/src/business
packages/llm/src/documents
packages/llm/src/llm
packages/llm/src/types
packages/llm/src/display
```

同步后运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: 三个命令通过。

### Task 5: `@hao/llm` Adapter 接入

**Files:**
- Modify: `packages/llm/src/adapter/index.ts`
- Modify: `packages/llm/src/index.ts`
- Modify: `packages/llm/src/adapter/public-entry.test.ts`
- Test: `packages/llm/src/adapter/education-analysis.test.ts`

- [ ] **Step 1: 扩展 public-entry 测试**

Modify `packages/llm/src/adapter/public-entry.test.ts`:

```ts
import { analyzeKnowledgePoints, analyzeMixedLearningMaterial, analyzeQuestions } from '../index';

describe('@hao/llm public entries', () => {
  it('exports education analysis functions', () => {
    expect(typeof analyzeKnowledgePoints).toBe('function');
    expect(typeof analyzeQuestions).toBe('function');
    expect(typeof analyzeMixedLearningMaterial).toBe('function');
  });
});
```

- [ ] **Step 2: 在 adapter 暴露新入口**

Modify `packages/llm/src/adapter/index.ts`:

```ts
import { analyzeMixedLearningMaterial as analyzeMixedLearningMaterialCommon } from '../business/education-analysis.ts';
import type { MixedLearningMaterialAnalysisResult } from '../types/public-types.ts';

export interface AnalyzeMixedLearningMaterialOptions extends AdapterCommonOptions {
  providerId: string;
  file?: EducationAnalysisFile;
  pdf?: EducationAnalysisFile;
  word?: EducationAnalysisFile;
  subjectName: string;
  knowledge?: unknown;
}

export async function analyzeMixedLearningMaterial(input: {
  providerId: string;
  file?: EducationAnalysisFile;
  pdf?: EducationAnalysisFile;
  word?: EducationAnalysisFile;
  subjectName: string;
  knowledge?: unknown;
} & AdapterCommonOptions): Promise<MixedLearningMaterialAnalysisResult> {
  const { providerId, ...commonOptions } = input;
  const provider = await resolveProviderTarget(providerId);

  return callCommonMixedLearningMaterialAnalysis({
    ...withProviderDefaults(commonOptions, provider.defaults),
    llmTarget: provider.llmTarget,
    apiKey: provider.apiKey,
  });
}

const callCommonMixedLearningMaterialAnalysis = analyzeMixedLearningMaterialCommon as unknown as (
  opts: Record<string, unknown>,
) => Promise<MixedLearningMaterialAnalysisResult>;
```

- [ ] **Step 3: 在包入口导出**

Modify `packages/llm/src/index.ts`:

```ts
export {
  analyzeKnowledgePoints,
  analyzeMixedLearningMaterial,
  analyzeQuestions,
} from './adapter';
```

- [ ] **Step 4: 运行 LLM 包测试**

Run:

```bash
pnpm --filter @hao/llm test
pnpm typecheck
```

Expected: LLM adapter 测试和类型检查通过。

- [ ] **Step 5: 提交 adapter 接入**

Run:

```bash
git add packages/llm/src
git commit -m "feat(llm): expose mixed learning material analysis"
```

### Task 6: admin端混合解析审核

**Owner:** B 进程，`worktrees/admin/`。

**Files:**
- Modify: `worktrees/admin/apps/admin/lib/education-analysis-adapter.ts`
- Modify: `worktrees/admin/apps/admin/lib/question-pipeline.ts`
- Create: `worktrees/admin/apps/admin/lib/learning-material-pipeline.ts`
- Create: `worktrees/admin/apps/admin/lib/source-document-review.ts`
- Modify: `worktrees/admin/apps/admin/app/page.tsx`
- Add tests under `worktrees/admin/apps/admin/lib/*.test.ts`

- [ ] **Step 1: 上传后展示文档画像**

admin上传文件后，先看到：

```text
资料类型：辅导讲义
科目：高中数学
结构：每页 4 个 slide
包含：知识讲解、题型总结、题目、详细解析
推荐流程：混合学习资料解析
```

- [ ] **Step 2: 来源审核**

admin可编辑：

```text
标题：第1讲 集合与逻辑重点题型全梳理
来源机构：高途
年份：2024
季节：秋季
讲次：第1讲
科目：高中数学
资料类型：辅导讲义
```

- [ ] **Step 3: 学习材料审核**

审核列表按类型分组：

```text
方法卡
易错提醒
题型总结
考情分析
解析总结
```

每条审核项必须展示原文来源页或 slide 缩略图。

- [ ] **Step 4: 缺答案题处理**

缺答案题在admin端显示为“缺答案，不能发布到web端练习”，动作只有：

```text
补答案
丢弃
保留为候选
```

- [ ] **Step 5: 测试**

Run inside `worktrees/admin/`:

```bash
pnpm --filter @hao/admin test
pnpm --filter @hao/admin lint
pnpm --filter @hao/admin typecheck
```

Expected: admin 测试、lint、类型检查通过。

- [ ] **Step 6: 提交 admin 改动**

Run inside `worktrees/admin/`:

```bash
git add apps/admin
git commit -m "feat(admin): review mixed learning materials"
```

### Task 7: web端学习材料消费

**Owner:** C 进程，`worktrees/web/`。

**Files:**
- Create: `worktrees/web/apps/web/lib/learning-materials.ts`
- Create: `worktrees/web/apps/web/lib/learning-materials.test.ts`
- Modify: `worktrees/web/apps/web/app/page.tsx`
- Modify: `worktrees/web/apps/web/lib/session-result-feedback.ts`
- Modify: `worktrees/web/apps/web/lib/mistake-book.ts`
- Modify student-facing pages under `worktrees/web/apps/web/app/study/**`

- [ ] **Step 1: 增加web端查询 helper**

Create `apps/web/lib/learning-materials.ts`:

```ts
export interface StudentLearningMaterial {
  title: string;
  typeLabel: string;
  content: string;
  studentSummary: string | null;
  sourceLabel: string | null;
}

export function toStudentMaterialTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    concept_explanation: '概念说明',
    method_card: '解题方法',
    common_mistake: '常见失误',
    question_type_summary: '题型总结',
    exam_trend: '考情提示',
    textbook_deep_dive: '教材深挖',
    solution_summary: '本题方法',
    study_advice: '复习建议',
  };

  return labels[type] ?? '学习提示';
}
```

- [ ] **Step 2: 今日复习展示方法卡**

首页今日任务中，若本次练习关联知识点有学习材料，展示最多 2 条：

```text
做题前先看
解题方法：利用子集关系求参
常见失误：含参问题求出参数后要回代检验互异性
```

- [ ] **Step 3: 错题详情展示本题方法**

错题详情页在解析后展示：

```text
本题方法
把 A ∪ B = B 转化为 A ⊆ B，再结合数轴判断端点范围。
```

- [ ] **Step 4: 隐藏内部字段**

web端不得展示：

```text
source_document_id
source_unit_id
material_type
provider_id
parse_job_id
fallback
ai_generated
```

- [ ] **Step 5: 测试**

Run inside `worktrees/web/`:

```bash
pnpm --filter @hao/web test
pnpm --filter @hao/web lint
pnpm --filter @hao/web typecheck
```

Expected: web 测试、lint、类型检查通过。

- [ ] **Step 6: 提交 web 改动**

Run inside `worktrees/web/`:

```bash
git add apps/web
git commit -m "feat(web): show learning materials for review"
```

### Task 8: 合并与整体验收

**Owner:** A 进程，主目录。

**Files:**
- Modify: `docs/Student_First_Round_MVP_Task_List.md`
- Create: `docs/Learning_Material_Ingestion_Acceptance.md`

- [ ] **Step 1: 合并 admin/web 分支**

Run:

```bash
bash scripts/merge-to-main.sh feat/admin
bash scripts/merge-to-main.sh feat/web
```

Expected: 两个分支合并到 main，无冲突或冲突已按业务语义解决。

- [ ] **Step 2: 运行全量验证**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: 三个命令通过。

- [ ] **Step 3: 编写人工验收文档**

Create `docs/Learning_Material_Ingestion_Acceptance.md`:

```markdown
# 学习资料资产化人工验收

## 样例 1：高途集合与逻辑辅导讲义

- 上传文件后，系统识别为辅导讲义。
- 来源信息包含“高途、2024、秋季、第1讲、集合与逻辑重点题型全梳理”。
- 至少出现 5 条学习材料，其中包含解题方法、常见失误、题型总结。
- 有解析的例题可以发布为题目。
- 缺答案题不能直接发布给学生练习。

## 样例 2：完整高考试卷

- 上传文件后，系统识别为完整试卷。
- 来源信息包含年份、考试名、试卷名、科目。
- 每道题发布后可以追溯到试卷题号。
- 搜索试卷标题可以找到该来源资料。
```

- [ ] **Step 4: 提交验收文档**

Run:

```bash
git add docs/Learning_Material_Ingestion_Acceptance.md docs/Student_First_Round_MVP_Task_List.md
git commit -m "docs: add learning material ingestion acceptance"
```

- [ ] **Step 5: 通知 B/C 同步**

完成 main 提交后告知：

```text
main 已更新，B/C 进程请在各自 worktree 内执行 `bash ../../scripts/sync-from-main.sh` 同步。
```

## 6. 验收标准

### 6.1 数据验收

- 完整试卷有结构化 `source_document`，能按标题、年份、试卷名查询。
- 正式题目能关联到 `question_source`。
- 学习材料能关联到 `knowledge_point`。
- 每条学习材料至少有一个 `kp_hint` 或正式 `kp_id`。
- 缺答案题不会进入web端正式练习。

### 6.2 admin端验收

- admin能看到文档画像。
- admin能审核来源信息。
- admin能审核学习材料。
- admin能识别缺答案、缺解析、题干不完整的题。
- admin能从审核项跳回原 PDF 页或 slide 缩略图。

### 6.3 web端验收

- 学生能在复习前看到“这类题怎么做”和“常见失误”。
- 学生做错题后能看到对应方法总结。
- 学生不会看到内部 ID、Provider、Job、fallback、ai_generated 等工程字段。
- 来源展示使用学习语言，例如“来源：2026 年高考卷 1 数学 第 8 题”。

### 6.4 LLM 质量验收

- 模型不编造答案。
- 原文没有解析时，`solution_text` 为空字符串。
- 学习材料能区分“原文抽取”和“模型归纳”。
- 每条抽取结果有来源定位。
- 对 PPT 四宫格 PDF 能按 slide 定位。

## 7. 实施顺序建议

推荐顺序：

1. Task 1：先更新 PRD 和技术边界。
2. Task 4：并行启动 `how-to-use-llm-proxy` 验证。
3. Task 2：主目录增加数据模型。
4. Task 3：主目录增加共享 schema。
5. Task 5：公共 LLM 方法验证通过后接入 adapter。
6. Task 6：B 进程做admin端审核。
7. Task 7：C 进程做web端消费。
8. Task 8：A 进程合并和整体验收。

## 8. 风险与控制

| 风险 | 控制 |
|---|---|
| LLM 从无答案题中编造答案 | schema 增加质量状态，缺答案题禁止发布 |
| 学习材料和知识点重复混乱 | 学习材料只挂 KP，不替代 KP |
| 来源信息只存在文件名里 | 增加 `source_document` 结构化存储 |
| web端暴露内部字段 | web helper 统一转换 label，页面测试覆盖 |
| admin/web 越界修改 | A 只改公共层，B 只改 `apps/admin`，C 只改 `apps/web` |
| prompt 在当前仓库临时试验 | 新解析能力先在 `how-to-use-llm-proxy` 验证 |

## 9. 当前计划状态

- [x] 完成需求分析。
- [x] 明确四类资产：知识点、题目、学习材料、来源。
- [x] 明确高途辅导 PPT 属于混合学习资料。
- [x] 明确完整试卷需要结构化来源。
- [x] 明确缺答案题不能直接发布给学生。
- [ ] 执行 Task 1：PRD 与技术文档对齐。
- [ ] 执行 Task 4：`how-to-use-llm-proxy` 解析能力验证。
- [x] 执行 Task 2：公共层数据模型。
- [x] 执行 Task 3：公共层 shared schema。
- [ ] 执行 Task 5：`@hao/llm` adapter，等待 `how-to-use-llm-proxy` 先验证并同步公共方法。
- [ ] 执行 Task 6/7：admin/web 工作区功能。
- [ ] 执行 Task 8：合并与验收。
