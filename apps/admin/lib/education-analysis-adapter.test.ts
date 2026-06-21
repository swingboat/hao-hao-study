import assert from 'node:assert/strict';
import test from 'node:test';
import type { LearningResourceAnalysisParserResult } from '@hao/llm';
import * as educationAdapter from './education-analysis-adapter.ts';

const { questionToStagingPayload } = educationAdapter;

test('questionToStagingPayload renders structured sub-questions instead of object placeholders', () => {
  const payload = questionToStagingPayload(
    {
      stem: '设实数集 $S$ 是满足下面两个条件的集合。',
      type: '填空题',
      number: '补充',
      source_pages: [7],
      sub_questions: [
        {
          stem: '求证：若 $a \\in S$，则 $1-\\frac{1}{a}\\in S$.',
          answer: '',
          number: '(1)',
          analysis: '由已知递推可得。',
        },
        {
          stem: '若 $2 \\in S$，则在 $S$ 中必含有其他两个数，试求出这两个数.',
          answer: '$-1$ 和 $\\frac{1}{2}$',
          number: '(2)',
          analysis: '代入递推式。',
        },
        {
          stem: '集合 $S$ 能否是单元素集？',
          answer: '不能',
          number: '(3)',
          analysis: '三种元素互不相等。',
        },
      ],
      related_knowledge_points: [{ id: 'kp-1', name: '集合与元素的概念及特性' }],
    },
    'math_senior',
  );

  assert.equal(
    payload.content,
    [
      '设实数集 $S$ 是满足下面两个条件的集合。',
      '1. 求证：若 $a \\in S$，则 $1-\\frac{1}{a}\\in S$.',
      '2. 若 $2 \\in S$，则在 $S$ 中必含有其他两个数，试求出这两个数.',
      '3. 集合 $S$ 能否是单元素集？',
    ].join('\n'),
  );
  assert.ok(!String(payload.content).includes('[object Object]'));
  assert.equal(payload.answer, '2. $-1$ 和 $\\frac{1}{2}$\n3. 不能');
  assert.equal(
    payload.solution_text,
    '1. 由已知递推可得。\n2. 代入递推式。\n3. 三种元素互不相等。',
  );
});

test('questionToStagingPayload normalizes nested option and answer values', () => {
  const payload = questionToStagingPayload(
    {
      stem: { text: '下列命题正确的是' },
      type: 'choice',
      options: [
        { label: 'A', value: { text: '$A \\subseteq B$' } },
        { key: 'B', content: { stem: '$B \\subseteq A$' } },
      ],
      answer: { text: 'A' },
      related_knowledge_points: [{ name: { text: '子集与真子集' } }],
    },
    'math_senior',
  );

  assert.equal(payload.content, '下列命题正确的是');
  assert.deepEqual(payload.options, [
    { label: 'A', text: '$A \\subseteq B$' },
    { label: 'B', text: '$B \\subseteq A$' },
  ]);
  assert.equal(payload.answer, 'A');
  assert.deepEqual(payload.kp_hints, ['子集与真子集']);
});

test('questionToStagingPayload keeps missing answers empty and preserves source_ref page', () => {
  const payload = questionToStagingPayload(
    {
      content: '写出集合 A 的子集个数。',
      question_type: 'fill_in',
      answer: '',
      solution_text: '',
      quality_status: 'missing_answer',
      kp_hints: ['子集'],
      source_ref: {
        page: 4,
        question_no: '第 2 题',
        text_snippet: '写出集合 A 的子集个数。',
      },
    },
    'math_senior',
  );

  assert.equal(payload.answer, '');
  assert.equal(payload.solution_text, '');
  assert.equal(payload.quality_status, 'missing_answer');
  assert.deepEqual(payload.source_ref, {
    page: 4,
    question_no: '第 2 题',
    text_snippet: '写出集合 A 的子集个数。',
  });
  assert.deepEqual(payload.source_hint, { page: 4, question_no: '第 2 题' });
});

test('learningResourceToStagingPayloads flattens knowledge threads into staging entities', () => {
  const flatten = (
    educationAdapter as typeof educationAdapter & {
      learningResourceToStagingPayloads?: (
        result: LearningResourceAnalysisParserResult,
        subjectId: string,
      ) => {
        sourceDocuments: Array<Record<string, unknown>>;
        learningMaterials: Array<Record<string, unknown>>;
        questions: Array<Record<string, unknown>>;
        knowledgePoints: Array<Record<string, unknown>>;
      };
    }
  ).learningResourceToStagingPayloads;
  assert.equal(typeof flatten, 'function');

  const result: LearningResourceAnalysisParserResult = {
    kind: 'learning_resource',
    source_document: {
      source_type: 'lesson_handout',
      title: '集合讲义第 1 讲',
      subject_name: '高中数学',
      stage: 'senior',
      grade: 'g10',
      provider: '',
      publisher: '',
      year: null,
      season: '',
      exam_name: '',
      paper_name: '',
      region: '',
      lesson_no: '',
      page_count: 6,
    },
    knowledge_threads: [
      {
        knowledge_point: {
          id: '00000000-0000-0000-0000-000000000001',
          name: '集合的概念',
          chapter_no: '1.1',
          brief: '集合基础',
          match_confidence: 0.92,
        },
        concept_explanations: [
          threadItem('概念说明', '集合是确定对象的整体。', 'source_extract', 1),
        ],
        method_cards: [threadItem('解题方法', '先看元素确定性。', 'model_summary', 2)],
        common_mistakes: [threadItem('易错提醒', '不要把元素顺序当作差异。', 'model_summary', 3)],
        question_type_summaries: [
          threadItem('题型总结', '子集个数题关注元素数量。', 'model_summary', 4),
        ],
        exam_trends: [threadItem('考情分析', '集合常作为小题入口。', 'model_summary', 5)],
        textbook_deep_dives: [
          threadItem('教材深挖', '教材定义强调对象确定性。', 'source_extract', 6),
        ],
        solution_summaries: [threadItem('解析总结', '分类讨论能减少漏解。', 'model_summary', 2)],
        study_advice: [threadItem('学习建议', '先用韦恩图辅助理解。', 'model_summary', 3)],
        questions: [
          {
            content: '集合 A={1,2} 的子集个数为多少？',
            question_type: 'fill_in',
            options: [],
            answer: '',
            solution_text: '',
            difficulty: 2,
            kp_hints: ['集合的概念'],
            quality_status: 'missing_answer',
            source_ref: { page: 4, question_no: '例 1', text_snippet: '子集个数' },
          },
        ],
        source_refs: [{ page: 4, question_no: '例 1', text_snippet: '子集个数' }],
      },
    ],
    unmapped_items: [
      {
        item_type: 'knowledge_point',
        reason: 'no_matching_knowledge_point',
        title: '集合中的新术语',
        content: '模型识别到教材库没有的术语。',
        source_ref: { page: 5, text_snippet: '新术语' },
        suggested_kp_hints: ['集合扩展'],
      },
    ],
    filtered_items_summary: { count: 0, categories: [] },
    diagnostics: {
      fallback_used: null,
      parse_error: null,
      validation_error: null,
      payload_log_path: '',
    },
  };

  const payloads = flatten?.(result, 'math_senior');
  assert.equal(payloads?.sourceDocuments.length, 1);
  assert.equal(payloads?.sourceDocuments[0]?.title, '集合讲义第 1 讲');
  assert.equal(payloads?.sourceDocuments[0]?.source_type, 'lesson_handout');
  assert.equal(payloads?.sourceDocuments[0]?._subject_id, 'math_senior');
  assert.equal(payloads?.learningMaterials.length, 8);
  assert.deepEqual(
    payloads?.learningMaterials.map((item) => item.material_type),
    [
      'concept_explanation',
      'method_card',
      'common_mistake',
      'question_type_summary',
      'exam_trend',
      'textbook_deep_dive',
      'solution_summary',
      'study_advice',
    ],
  );
  assert.equal(
    (payloads?.learningMaterials[0]?.source_ref as { page?: number } | undefined)?.page,
    1,
  );
  assert.equal(payloads?.questions.length, 1);
  assert.equal(payloads?.questions[0]?.answer, '');
  assert.equal(payloads?.questions[0]?.quality_status, 'missing_answer');
  assert.equal((payloads?.questions[0]?.source_ref as { page?: number } | undefined)?.page, 4);
  assert.equal(payloads?.knowledgePoints.length, 1);
  assert.equal(payloads?.knowledgePoints[0]?.name, '集合中的新术语');
});

function threadItem(
  title: string,
  content: string,
  contentOrigin: 'source_extract' | 'model_summary',
  page: number,
) {
  return {
    title,
    content,
    content_origin: contentOrigin,
    source_ref: { page, text_snippet: content.slice(0, 20) },
    confidence: 0.88,
    student_summary: content,
    kp_hints: ['集合的概念'],
  };
}
