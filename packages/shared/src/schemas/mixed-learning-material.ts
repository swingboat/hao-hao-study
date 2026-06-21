import { z } from 'zod';

import { KnowledgePointParsedSchema } from './knowledge-point';
import { LearningMaterialParsedSchema } from './learning-material';
import { QuestionOptionSchema, QuestionTypeSchema } from './question';
import { SourceDocumentParsedSchema } from './source-document';
import { SourceRefSchema, SourceUnitParsedSchema } from './source-unit';

export const QuestionQualityStatusSchema = z.enum([
  'publishable',
  'missing_answer',
  'missing_solution',
  'incomplete_stem',
  'needs_human_review',
]);
export type QuestionQualityStatusParsed = z.infer<typeof QuestionQualityStatusSchema>;

export const MixedQuestionCandidateParsedSchema = z
  .object({
    content: z
      .string()
      .min(5, '题干至少 5 字符（疑似抽取失败）')
      .max(2000, '题干不超过 2000 字符（疑似把多题合并）'),
    question_type: QuestionTypeSchema,
    options: z.array(QuestionOptionSchema).default([]),
    answer: z.string().max(500, '答案不超过 500 字符').default(''),
    solution_text: z.string().max(3000, '解析不超过 3000 字符').default(''),
    difficulty: z.number().int().min(1).max(5).default(3),
    kp_hints: z.array(z.string().min(2).max(50)).max(5).default([]),
    quality_status: QuestionQualityStatusSchema.default('needs_human_review'),
    source_ref: SourceRefSchema.optional(),
  })
  .strict()
  .superRefine((question, ctx) => {
    if (question.question_type === 'choice' && question.options.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'choice 题至少 2 个选项',
      });
    }

    if (question.question_type === 'fill_in' && question.options.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'fill_in 题不应包含 options',
      });
    }

    if (question.quality_status === 'publishable') {
      if (!question.answer.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['answer'],
          message: 'publishable 题目必须有答案',
        });
      }
      if (question.kp_hints.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['kp_hints'],
          message: 'publishable 题目至少要有 1 个 kp_hint',
        });
      }
    }

    if (question.answer.trim() && question.question_type === 'choice') {
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
export type MixedQuestionCandidateParsed = z.infer<typeof MixedQuestionCandidateParsedSchema>;

export const MixedLearningMaterialBatchSchema = z
  .object({
    source_document: SourceDocumentParsedSchema,
    source_units: z.array(SourceUnitParsedSchema).max(1000).default([]),
    knowledge_points: z.array(KnowledgePointParsedSchema).max(500).default([]),
    learning_materials: z.array(LearningMaterialParsedSchema).max(300).default([]),
    questions: z.array(MixedQuestionCandidateParsedSchema).max(300).default([]),
  })
  .strict();
export type MixedLearningMaterialBatch = z.infer<typeof MixedLearningMaterialBatchSchema>;
