import { describe, expect, it } from 'vitest';

import {
  buildMixedLearningMaterialFinalPrompt,
  buildMixedLearningMaterialPagePrompt,
  learningResourceAnalysisBatchSchema,
  mixedLearningMaterialBatchSchema,
  parseMixedLearningMaterialJson,
  parseMixedLearningMaterialPages,
} from './mixed-learning-material-parser';

describe('mixed learning material parser', () => {
  it('builds prompts that require mixed assets, source refs, and JSON-only output', () => {
    const pagePrompt = buildMixedLearningMaterialPagePrompt({
      pageNumber: 3,
      totalPages: 12,
      subjectName: '高中数学',
    });

    expect(pagePrompt).toContain('第 3/12 页');
    expect(pagePrompt).toContain('method_card');
    expect(pagePrompt).toContain('common_mistake');
    expect(pagePrompt).toContain('question_type_summary');
    expect(pagePrompt).toContain('source_ref');
    expect(pagePrompt).toContain('slide_no');
    expect(pagePrompt).toContain('question_no');
    expect(pagePrompt).toContain('content_origin');
    expect(pagePrompt).toContain('answer 必须是空字符串');
    expect(pagePrompt).toContain('solution_text 必须是空字符串');
    expect(pagePrompt).toContain('只输出 JSON');

    const finalPrompt = buildMixedLearningMaterialFinalPrompt({
      subjectName: '高中数学',
      pageResults: [
        { page_number: 1, text: '第1页：集合与逻辑重点题型全梳理' },
        { page_number: 2, text: '第2页：例题2 含参问题回代检验互异性' },
      ],
    });

    expect(finalPrompt).toContain('source_document');
    expect(finalPrompt).toContain('exam_paper');
    expect(finalPrompt).toContain('2026 年高考卷 1 数学');
    expect(finalPrompt).toContain('题号来源');
    expect(finalPrompt).toContain('只输出 JSON');
    expect(finalPrompt).toContain('含参问题回代检验互异性');
  });

  it('normalizes missing answers, empty solutions, and required source refs', () => {
    const parsed = parseMixedLearningMaterialJson(
      JSON.stringify({
        source_document: {
          source_type: 'lesson_handout',
          title: '集合与逻辑重点题型全梳理',
          subject_name: '高中数学',
          stage: 'senior',
          provider: '高途',
          year: 2024,
          season: '秋季',
        },
        source_units: [
          {
            unit_kind: 'slide',
            page_no: 3,
            slide_no: 10,
            question_no: '例题2',
            bbox: [0, 0, 50, 50],
            text_snippet: '含参问题求出参数后，需要回代检验集合元素互异性。',
          },
        ],
        knowledge_points: [
          {
            name: '集合中元素的互异性',
            chapter_no: null,
            brief: '集合中的元素不能重复。',
          },
        ],
        learning_materials: [
          {
            material_type: 'method_card',
            title: '含参问题回代检验互异性',
            content: '含参集合问题求出参数后，需要回代检查元素互异性。',
            student_summary: '求出参数后别急着选答案，先回代检查集合元素是否互异。',
            content_origin: 'model_summary',
            kp_hints: ['集合中元素的互异性'],
            source_ref: {
              page: 3,
              slide_no: 10,
              question_no: '例题2',
              text_snippet: '回代检验互异性',
            },
            confidence: 0.92,
          },
        ],
        questions: [
          {
            content: '若集合 A={1,a,a^2}，求 a 的取值范围。',
            question_type: 'fill_in',
            options: [],
            kp_hints: ['集合中元素的互异性'],
            source_ref: {
              page: 3,
              slide_no: 10,
              question_no: '例题2',
            },
          },
        ],
      }),
      {
        subjectName: '高中数学',
        fallbackTitle: '集合与逻辑重点题型全梳理.pdf',
        pageCount: 6,
      },
    );

    expect(parsed.error).toBeNull();
    expect(parsed.batch.source_document.page_count).toBe(6);
    expect(parsed.batch.learning_materials[0]?.source_ref.page).toBe(3);
    expect(parsed.batch.questions[0]?.answer).toBe('');
    expect(parsed.batch.questions[0]?.solution_text).toBe('');
    expect(parsed.batch.questions[0]?.quality_status).toBe('missing_answer');
    expect(mixedLearningMaterialBatchSchema.safeParse(parsed.batch).success).toBe(true);
  });

  it('validates learning resource knowledge-thread output', () => {
    const validation = learningResourceAnalysisBatchSchema.safeParse({
      source_document: {
        source_type: 'lesson_handout',
        title: '集合与逻辑重点题型全梳理',
        subject_name: '高中数学',
        stage: 'senior',
        grade: 'g10',
        provider: '高途',
        publisher: '',
        year: 2024,
        season: '秋季',
        exam_name: '',
        paper_name: '',
        region: '',
        lesson_no: '第1讲',
        page_count: 20,
      },
      knowledge_threads: [
        {
          knowledge_point: {
            id: 'kp-set-mutual',
            name: '集合中元素的互异性',
            chapter_no: null,
            brief: '集合中的元素不能重复。',
            match_confidence: 0.95,
          },
          concept_explanations: [],
          method_cards: [],
          common_mistakes: [
            {
              title: '含参问题回代检验互异性',
              content: '求出参数后回代检查互异性。',
              content_origin: 'source_extract',
              source_ref: { page: 3, slide_no: 10, question_no: '例题2' },
              confidence: 0.9,
            },
          ],
          question_type_summaries: [],
          exam_trends: [],
          textbook_deep_dives: [],
          solution_summaries: [],
          study_advice: [],
          questions: [
            {
              content: '已知集合 A，求参数。',
              question_type: 'fill_in',
              options: [],
              answer: '',
              solution_text: '',
              difficulty: 1,
              quality_status: 'missing_answer',
              source_ref: { page: 3, slide_no: 10, question_no: '例题2' },
            },
          ],
          source_refs: [{ page: 3, slide_no: 10, question_no: '例题2' }],
        },
      ],
      unmapped_items: [
        {
          item_type: 'learning_material',
          reason: 'no_matching_knowledge_point',
          title: '综合提醒',
          content: '无法确定唯一知识点。',
          source_ref: { page: 4, text_snippet: '综合提醒' },
          suggested_kp_hints: [],
        },
      ],
      filtered_items_summary: {
        count: 1,
        categories: ['qr_code'],
      },
      diagnostics: {
        fallback_used: null,
        parse_error: null,
        validation_error: null,
        payload_log_path: '',
      },
    });

    expect(validation.success).toBe(true);
  });

  it('falls back to page JSON when final synthesis has no parseable JSON', async () => {
    const result = await parseMixedLearningMaterialPages({
      subjectName: '高中数学',
      fallbackTitle: '集合与逻辑重点题型全梳理.pdf',
      pages: [{ pageNumber: 1, mimeType: 'image/png', data: 'page-1' }],
      llmTarget: {
        id: 'test-target',
        provider: 'openai',
        api_shape: 'openai-chat-completions',
      },
      parseDocumentPagesImpl: async (request: {
        llmTarget: { id: string; provider: string; api_shape: string };
      }) => ({
        document_type: 'mixed_learning_material',
        target_id: request.llmTarget.id,
        provider: request.llmTarget.provider,
        api_shape: request.llmTarget.api_shape,
        ok: true,
        pages: [
          {
            page_number: 1,
            ok: true,
            text: JSON.stringify({
              source_document: {
                source_type: 'lesson_handout',
                title: '高中数学讲义',
                subject_name: '高中数学',
                stage: 'senior',
                page_count: 1,
              },
              source_units: [
                {
                  unit_kind: 'slide',
                  page_no: 1,
                  slide_no: 3,
                  text_snippet: '含参问题回代检验互异性',
                },
              ],
              knowledge_points: [],
              learning_materials: [
                {
                  material_type: 'common_mistake',
                  title: '含参问题回代检验互异性',
                  content: '含参集合问题求出参数后，一定要回代检验元素互异性。',
                  student_summary: '求参后先回代。',
                  content_origin: 'source_extract',
                  kp_hints: ['集合中元素的互异性'],
                  source_ref: { page: 1, slide_no: 3 },
                  confidence: 0.9,
                },
              ],
              questions: [],
            }),
          },
        ],
        text: '最终汇总失败，没有 JSON。',
        payload_log_path: '/tmp/payload.log',
      }),
    });

    expect(result.fallback_used).toBe('page_results');
    expect(result.parse_error).toBe('No JSON object found in model output.');
    expect(result.payload_log_path).toBe('/tmp/payload.log');
    expect(result.source_document.title).toBe('集合与逻辑重点题型全梳理');
    expect(result.learning_materials).toHaveLength(1);
    expect(result.learning_materials[0]?.source_ref.page).toBe(1);
  });
});
