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
export type SourceDocumentTypeParsed = z.infer<typeof SourceDocumentTypeSchema>;

export const SourceDocumentParsedSchema = z
  .object({
    source_type: SourceDocumentTypeSchema,
    title: z.string().min(2).max(120),
    subject_name: z.string().min(2).max(30),
    stage: z.enum(['primary', 'junior', 'senior']).optional(),
    grade: z
      .enum(['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10', 'g11', 'g12'])
      .optional(),
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
