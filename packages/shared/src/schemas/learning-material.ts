import { z } from 'zod';

import { SourceRefSchema } from './source-unit';

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
export type LearningMaterialTypeParsed = z.infer<typeof LearningMaterialTypeSchema>;

export const LearningMaterialContentOriginSchema = z.enum(['source_extract', 'model_summary']);
export type LearningMaterialContentOriginParsed = z.infer<
  typeof LearningMaterialContentOriginSchema
>;

export const LearningMaterialParsedSchema = z
  .object({
    material_type: LearningMaterialTypeSchema,
    title: z.string().min(2).max(80),
    content: z.string().min(10).max(3000),
    student_summary: z.string().min(5).max(500).optional(),
    content_origin: LearningMaterialContentOriginSchema.default('source_extract'),
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
