import { z } from 'zod';

export const SourceUnitKindSchema = z.enum([
  'page',
  'slide',
  'question_region',
  'explanation_region',
  'text_block',
]);
export type SourceUnitKindParsed = z.infer<typeof SourceUnitKindSchema>;

export const SourceRefSchema = z
  .object({
    page: z.number().int().positive().nullable().optional(),
    slide_no: z.number().int().positive().nullable().optional(),
    question_no: z.string().max(30).nullable().optional(),
    text_snippet: z.string().max(300).nullable().optional(),
  })
  .strict();
export type SourceRefParsed = z.infer<typeof SourceRefSchema>;

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
