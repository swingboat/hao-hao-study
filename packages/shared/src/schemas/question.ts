/**
 * 题目（question）解析输出 zod schema — LLM → admin 审核流程契约
 *
 * 用途：试题解析结果的共享 schema。LLM 业务解析入口必须先在
 *      how-to-use-llm-proxy 验证通过，再同步到 @hao/llm。
 *
 * 字段对齐策略（与 packages/db/prisma/schema.prisma model question 收敛）：
 *   - content         必填，题干正文；图片题在末尾用 `[图片描述: ...]` 标注
 *   - question_type       仅 'choice' / 'fill_in'（决议 Q2=a；essay 被强制丢弃在 F3.7）
 *   - options         choice 时必填非空；fill_in 时数组留空
 *   - answer          标准答案；choice 形如 "A" / "AB"；fill_in 形如 "f(x)=2x+1" 或多空 "1;2;3"
 *   - solution_text   解析全文；LLM 抽不到时给空字符串，留admin在 F3.4 抽屉手补
 *   - difficulty      1-5；LLM 置信度低时按 3 兜底（不要让 LLM 留空）
 *   - kp_hints        关联 KP 的候选**名称**（不是 UUID）；F3.5 在 admin 端映射到正式 kp_ids
 *                     至少 1 条，第一条视为主 KP（primary_kp 候选）
 *   - source_hint     可选；让admin在 F3.4 diff 抽屉能快速翻回 PDF 原文校对
 *
 * 不放进 schema 的字段（由 admin 上下文 / 审核流程注入）：
 *   - id                 由 DB gen_random_uuid()
 *   - subject_id         admin 上传时已选学科
 *   - kp_ids / primary_kp_id   F3.5 把 kp_hints 映射到正式 KP 后写入
 *   - created_at         DB now()
 */
import { z } from 'zod';

/** 题型 — v0.1 仅 2 类（决议 Q2=a） */
export const QuestionTypeSchema = z.enum(['choice', 'fill_in']);
export type QuestionTypeParsed = z.infer<typeof QuestionTypeSchema>;

/** 选项 — choice 题型专用，单选/多选共用 */
export const QuestionOptionSchema = z.object({
  /** 选项标号，大写字母 A-Z；多选时仍是单字母（多个选项各占一条） */
  label: z.string().regex(/^[A-Z]$/, '选项标号必须是单个大写字母 A-Z'),
  /** 选项正文 */
  text: z.string().min(1, '选项正文不能为空').max(500, '选项正文不超过 500 字符'),
});
export type QuestionOptionParsed = z.infer<typeof QuestionOptionSchema>;

/** 单题 LLM 抽取结果（一行 staging） */
export const QuestionParsedSchema = z
  .object({
    content: z
      .string()
      .min(5, '题干至少 5 字符（疑似抽取失败）')
      .max(2000, '题干不超过 2000 字符（疑似把多题合并）'),
    question_type: QuestionTypeSchema,
    /**
     * choice 题型必须给 ≥2 个选项；fill_in 题型必须留空数组。
     * v0.1 不放 minItems 在 zod 数组上避免 Gemini state explosion，靠 superRefine 兜底。
     */
    options: z.array(QuestionOptionSchema).default([]),
    answer: z.string().min(1, '答案不能为空').max(500, '答案不超过 500 字符'),
    /**
     * 解析全文。LLM 抽不到时务必给空字符串而非省略字段，避免 staging 出 undefined。
     * admin在 F3.4 抽屉里看到空就知道要手补。
     */
    solution_text: z.string().max(3000, '解析不超过 3000 字符').default(''),
    /** 1=最易 ... 5=最难。LLM 置信度低时按 3 兜底，不要留空 */
    difficulty: z.number().int().min(1).max(5),
    /**
     * 关联 KP 候选**名称**列表。
     * 第一条为主 KP 候选（F3.5 把 kp_hints[0] 标蓝），其它进 kp_ids[] 数组。
     * v0.1 不靠 zod minItems 强约束，由 superRefine 兜底。
     */
    kp_hints: z.array(z.string().min(2).max(50)),
    /** PDF 来源定位 —— F3.4 diff 抽屉用来翻原文校对 */
    source_hint: z
      .object({
        /** 在原 PDF 第几页（从 1 起） */
        page: z.number().int().positive().nullable().optional(),
        /** 题集内题号，如 "第 3 题" / "1.2.3" / "（一）2" */
        question_no: z.string().max(20).nullable().optional(),
      })
      .optional(),
  })
  .superRefine((question, ctx) => {
    // choice 题型必须给 ≥2 个选项
    if (question.question_type === 'choice' && question.options.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'choice 题至少 2 个选项',
      });
    }
    // fill_in 题型不应有 options
    if (question.question_type === 'fill_in' && question.options.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'fill_in 题不应包含 options',
      });
    }
    // kp_hints 至少 1 条
    if (question.kp_hints.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kp_hints'],
        message: '至少要给 1 个 kp_hint 作为主 KP 候选',
      });
    }
    // kp_hints 内部去重
    const seen = new Set<string>();
    for (const h of question.kp_hints) {
      if (seen.has(h)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['kp_hints'],
          message: `kp_hints 不应包含重复条目：${h}`,
        });
        break;
      }
      seen.add(h);
    }
    // choice 答案应为 A-Z 字母（单选 "A"，多选 "AB"），且每个字母都在 options 里
    if (question.question_type === 'choice') {
      const m = question.answer.match(/^[A-Z]+$/);
      if (!m) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['answer'],
          message: 'choice 答案必须由大写字母组成（如 "A" 或 "AB"）',
        });
      } else {
        const labels = new Set(question.options.map((o) => o.label));
        for (const ch of question.answer) {
          if (!labels.has(ch)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['answer'],
              message: `答案字母 ${ch} 在 options 里找不到对应选项`,
            });
            break;
          }
        }
      }
    }
  });
export type QuestionParsed = z.infer<typeof QuestionParsedSchema>;

/**
 * 批量输出 —— LLM 一次解析的结果集合。
 *
 * 上限 300：一份题集 PDF 100 页约 200-300 题；超过即视为重复抽取 / 提示词失控。
 * 与 KP 的 500 上限不同的是，题目体量本身更大（含 options/solution），单次给太多容易
 * 触 LLM 输出 token 上限被截断 —— 公共解析入口负责处理分片与合并。
 */
export const QuestionBatchSchema = z.object({
  questions: z
    .array(QuestionParsedSchema)
    .min(1, '至少应抽出 1 道题')
    .max(300, '单次解析超过 300 道题，疑似提示词失控'),
});
export type QuestionBatch = z.infer<typeof QuestionBatchSchema>;
