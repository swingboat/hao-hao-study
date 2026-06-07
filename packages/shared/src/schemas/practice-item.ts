/**
 * 题目（practice_item）解析输出 zod schema — LLM → admin 审核流程契约
 *
 * 用途：admin 在 F3.1–F3.2 把题集 PDF / 图片喂给 LLM（通过 analyzePdf 或单次 callLLM），
 *      要求 LLM 输出严格符合本 schema 的 JSON。callLLM 内部会做 structured-output 校验；
 *      不通过则 retry 1 次。
 *
 * 字段对齐策略（与 packages/db/prisma/schema.prisma model practice_item 收敛）：
 *   - content         必填，题干正文；图片题在末尾用 `[图片描述: ...]` 标注
 *   - item_type       仅 'choice' / 'fill_in'（决议 Q2=a；essay 被强制丢弃在 F3.7）
 *   - options         choice 时必填非空；fill_in 时数组留空
 *   - answer          标准答案；choice 形如 "A" / "AB"；fill_in 形如 "f(x)=2x+1" 或多空 "1;2;3"
 *   - solution_text   解析全文；LLM 抽不到时给空字符串，留运营在 F3.4 抽屉手补
 *   - difficulty      1-5；LLM 置信度低时按 3 兜底（不要让 LLM 留空）
 *   - kp_hints        关联 KP 的候选**名称**（不是 UUID）；F3.5 在 admin 端映射到正式 kp_ids
 *                     至少 1 条，第一条视为主 KP（primary_kp 候选）
 *   - source_hint     可选；让运营在 F3.4 diff 抽屉能快速翻回 PDF 原文校对
 *
 * 不放进 schema 的字段（由 admin 上下文 / 审核流程注入）：
 *   - id                 由 DB gen_random_uuid()
 *   - subject_id         admin 上传时已选学科
 *   - kp_ids / primary_kp_id   F3.5 把 kp_hints 映射到正式 KP 后写入
 *   - created_at         DB now()
 */
import { z } from 'zod';

/** 题型 — v0.1 仅 2 类（决议 Q2=a） */
export const PracticeItemTypeSchema = z.enum(['choice', 'fill_in']);
export type PracticeItemTypeParsed = z.infer<typeof PracticeItemTypeSchema>;

/** 选项 — choice 题型专用，单选/多选共用 */
export const PracticeOptionSchema = z.object({
  /** 选项标号，大写字母 A-Z；多选时仍是单字母（多个选项各占一条） */
  label: z.string().regex(/^[A-Z]$/, '选项标号必须是单个大写字母 A-Z'),
  /** 选项正文 */
  text: z.string().min(1, '选项正文不能为空').max(500, '选项正文不超过 500 字符'),
});
export type PracticeOptionParsed = z.infer<typeof PracticeOptionSchema>;

/** 单题 LLM 抽取结果（一行 staging） */
export const PracticeItemParsedSchema = z
  .object({
    content: z
      .string()
      .min(5, '题干至少 5 字符（疑似抽取失败）')
      .max(2000, '题干不超过 2000 字符（疑似把多题合并）'),
    item_type: PracticeItemTypeSchema,
    /**
     * choice 题型必须给 ≥2 个选项；fill_in 题型必须留空数组。
     * v0.1 不放 minItems 在 zod 数组上避免 Gemini state explosion，靠 superRefine 兜底。
     */
    options: z.array(PracticeOptionSchema).default([]),
    answer: z.string().min(1, '答案不能为空').max(500, '答案不超过 500 字符'),
    /**
     * 解析全文。LLM 抽不到时务必给空字符串而非省略字段，避免 staging 出 undefined。
     * 运营在 F3.4 抽屉里看到空就知道要手补。
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
        item_no: z.string().max(20).nullable().optional(),
      })
      .optional(),
  })
  .superRefine((item, ctx) => {
    // choice 题型必须给 ≥2 个选项
    if (item.item_type === 'choice' && item.options.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'choice 题至少 2 个选项',
      });
    }
    // fill_in 题型不应有 options
    if (item.item_type === 'fill_in' && item.options.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'fill_in 题不应包含 options',
      });
    }
    // kp_hints 至少 1 条
    if (item.kp_hints.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kp_hints'],
        message: '至少要给 1 个 kp_hint 作为主 KP 候选',
      });
    }
    // kp_hints 内部去重
    const seen = new Set<string>();
    for (const h of item.kp_hints) {
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
    if (item.item_type === 'choice') {
      const m = item.answer.match(/^[A-Z]+$/);
      if (!m) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['answer'],
          message: 'choice 答案必须由大写字母组成（如 "A" 或 "AB"）',
        });
      } else {
        const labels = new Set(item.options.map((o) => o.label));
        for (const ch of item.answer) {
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
export type PracticeItemParsed = z.infer<typeof PracticeItemParsedSchema>;

/**
 * 批量输出 —— LLM 一次解析的结果集合。
 *
 * 上限 300：一份题集 PDF 100 页约 200-300 题；超过即视为重复抽取 / 提示词失控。
 * 与 KP 的 500 上限不同的是，题目体量本身更大（含 options/solution），单次给太多容易
 * 触 LLM 输出 token 上限被截断 —— analyzePdf 的 chunk 切片机制已经处理这点，单 chunk
 * 实际产 5-30 题更常见。
 */
export const PracticeItemBatchSchema = z.object({
  items: z
    .array(PracticeItemParsedSchema)
    .min(1, '至少应抽出 1 道题')
    .max(300, '单次解析超过 300 道题，疑似提示词失控'),
});
export type PracticeItemBatch = z.infer<typeof PracticeItemBatchSchema>;
