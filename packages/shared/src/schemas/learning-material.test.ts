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
