import { describe, expect, it } from 'vitest';

import {
  MixedLearningMaterialBatchSchema,
  MixedQuestionCandidateParsedSchema,
} from './mixed-learning-material';

describe('MixedLearningMaterialBatchSchema', () => {
  it('accepts source, source units, materials, and question candidates in one parsed result', () => {
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
      source_units: [
        {
          unit_kind: 'slide',
          page_no: 10,
          slide_no: 39,
          text_snippet: '集合中的求参问题',
        },
      ],
      learning_materials: [
        {
          material_type: 'common_mistake',
          title: '含参问题回代检验',
          content: '含参集合问题求出参数后，需要回代检查元素互异性。',
          kp_hints: ['集合中元素的互异性'],
          confidence: 0.9,
        },
      ],
      questions: [
        {
          content: '已知集合 A={x|-2≤x≤5}，B={x|m-4≤x≤3m+2}，若 A∪B=B，求实数 m 的取值范围。',
          question_type: 'fill_in',
          answer: '',
          solution_text: '',
          difficulty: 3,
          kp_hints: ['集合中的求参问题'],
          quality_status: 'missing_answer',
          source_ref: { page: 10, slide_no: 37, question_no: '例题14' },
        },
      ],
      knowledge_points: [],
    });

    expect(parsed.success).toBe(true);
  });
});

describe('MixedQuestionCandidateParsedSchema', () => {
  it('rejects publishable questions without an answer', () => {
    const parsed = MixedQuestionCandidateParsedSchema.safeParse({
      content: '已知集合 A={1,2}，求 A 的子集个数。',
      question_type: 'fill_in',
      answer: '',
      solution_text: '',
      difficulty: 1,
      kp_hints: ['子集个数问题'],
      quality_status: 'publishable',
    });

    expect(parsed.success).toBe(false);
  });

  it('allows missing-answer questions to stay as review candidates', () => {
    const parsed = MixedQuestionCandidateParsedSchema.safeParse({
      content: '已知集合 A={1,2}，求 A 的子集个数。',
      question_type: 'fill_in',
      answer: '',
      solution_text: '',
      difficulty: 1,
      kp_hints: ['子集个数问题'],
      quality_status: 'missing_answer',
    });

    expect(parsed.success).toBe(true);
  });
});
