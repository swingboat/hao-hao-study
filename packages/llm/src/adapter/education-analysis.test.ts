import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findUnique = vi.fn();

vi.mock('@hao/db', () => ({
  prisma: {
    llm_provider: {
      findUnique: (args: unknown) => findUnique(args),
    },
  },
}));

const {
  analyzeKnowledgePoints,
  analyzeLearningResource,
  analyzeMixedLearningMaterial,
  analyzeQuestions,
} = await import('./index');

const OPENAI_PROVIDER = {
  id: 'openai-chat-gemini-3.1-pro',
  protocol: 'openai_chat',
  endpoint: 'https://example.com/openai/v1/chat/completions',
  model: 'google.gemini-3.1-pro-global',
  capabilities: { text: true, vision: true },
  auth_env_var: 'LLM_PROXY_API_KEY',
  default_params: { temperature: 0.2 },
  max_output_tokens: null,
  quirks: {},
  output_normalizers: [],
  enabled: true,
};

beforeEach(() => {
  process.env.LLM_PROXY_API_KEY = 'test-token-xyz';
  findUnique.mockReset();
});

afterEach(() => {
  process.env.LLM_PROXY_API_KEY = undefined;
});

describe('@hao/llm adapter education analysis API', () => {
  it('resolves providerId and calls the synced knowledge parser with llmTarget/apiKey', async () => {
    findUnique.mockResolvedValue(OPENAI_PROVIDER);
    const parsePdfKnowledgePointsImpl = vi.fn(async (request) => {
      expect(request.providerId).toBeUndefined();
      expect(request.file).toBeUndefined();
      expect(request.apiKey).toBe('test-token-xyz');
      expect(request.pdf).toEqual({
        name: 'textbook.pdf',
        data: 'base64-pdf',
      });
      expect(request.llmTarget).toEqual(
        expect.objectContaining({
          id: 'openai-chat-gemini-3.1-pro',
          provider: 'openai_chat',
          api_shape: 'openai-chat-completions',
          model: 'google.gemini-3.1-pro-global',
          path: 'https://example.com/openai/v1/chat/completions',
        }),
      );
      expect(request.llmTarget.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer ${LLM_PROXY_API_KEY}',
      });

      return {
        document_type: 'pdf',
        target_id: request.llmTarget.id,
        provider: request.llmTarget.provider,
        model: request.llmTarget.model,
        api_shape: request.llmTarget.api_shape,
        ok: true,
        pages: [{ page_number: 1, ok: true, text: '第一页', latency_ms: 10 }],
        coverage_summary: {
          input_candidate_count: 1,
          output_knowledge_point_count: 1,
          expected_range: '100-180',
          coverage_notes: [],
        },
        chapters: [
          {
            number: '第一章',
            title: '集合',
            sections: [
              {
                number: '1.1',
                title: '集合的概念',
                knowledge_points: [{ id: 7, name: '元素与集合', source_pages: [1] }],
              },
            ],
          },
        ],
        uncertain_notes: [],
        parse_error: null,
      };
    });

    const result = await analyzeKnowledgePoints({
      providerId: 'openai-chat-gemini-3.1-pro',
      file: {
        type: 'pdf',
        name: 'textbook.pdf',
        data: 'base64-pdf',
      },
      parsePdfKnowledgePointsImpl,
    });

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'openai-chat-gemini-3.1-pro' } });
    expect(parsePdfKnowledgePointsImpl).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('knowledge_points');
    expect(result.llm).toEqual({
      llm_target_id: 'openai-chat-gemini-3.1-pro',
      target_id: 'openai-chat-gemini-3.1-pro',
      provider: 'openai_chat',
      model: 'google.gemini-3.1-pro-global',
      api_shape: 'openai-chat-completions',
    });
    expect(result.knowledge_points[0]?.id).toBe(7);
  });

  it('routes Word question parsing through the synced question parser contract', async () => {
    findUnique.mockResolvedValue(OPENAI_PROVIDER);
    const parsePdfQuestionsImpl = vi.fn(async () => {
      throw new Error('PDF parser should not be called for Word files');
    });
    const parseWordQuestionsImpl = vi.fn(async (request) => {
      expect(request.apiKey).toBe('test-token-xyz');
      expect(request.word).toEqual({
        name: 'questions.docx',
        path: '/tmp/questions.docx',
      });
      expect(request.llmTarget.id).toBe('openai-chat-gemini-3.1-pro');
      expect(request.pagePrompt({ pageNumber: 1, totalPages: 1 })).toContain('id=ks1-kp-1');

      return {
        document_type: 'word',
        target_id: request.llmTarget.id,
        provider: request.llmTarget.provider,
        model: request.llmTarget.model,
        api_shape: request.llmTarget.api_shape,
        ok: true,
        pages: [{ page_number: 1, ok: true, text: '第1题', latency_ms: 10 }],
        question_count: 1,
        questions: [
          {
            id: 9,
            number: '1',
            type: '选择题',
            stem: '若 a 是集合 A 的元素，下列记法正确的是？',
            options: ['A. a ∈ A', 'B. A ∈ a'],
            answer: 'A',
            related_knowledge_points: [{ id: 'ks1-kp-1', name: '元素与集合' }],
            source_pages: [1],
          },
        ],
        uncertain_notes: [],
        parse_error: null,
      };
    });

    const result = await analyzeQuestions({
      providerId: 'openai-chat-gemini-3.1-pro',
      file: {
        type: 'word',
        name: 'questions.docx',
        path: '/tmp/questions.docx',
      },
      knowledge: [
        {
          kind: 'knowledge_points',
          source: { name: '数学必修第一册.pdf' },
          knowledge_points: [{ id: 'kp-1', name: '元素与集合' }],
        },
      ],
      parsePdfQuestionsImpl,
      parseWordQuestionsImpl,
    });

    expect(parsePdfQuestionsImpl).not.toHaveBeenCalled();
    expect(parseWordQuestionsImpl).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('questions');
    expect(result.llm.target_id).toBe('openai-chat-gemini-3.1-pro');
    expect(result.questions[0]?.id).toBe(9);
  });

  it('resolves providerId and calls the synced mixed learning material parser', async () => {
    findUnique.mockResolvedValue(OPENAI_PROVIDER);
    const parsePdfMixedLearningMaterialImpl = vi.fn(async (request) => {
      expect(request.providerId).toBeUndefined();
      expect(request.file).toBeUndefined();
      expect(request.apiKey).toBe('test-token-xyz');
      expect(request.subjectName).toBe('高中数学');
      expect(request.pdf).toEqual({
        name: '集合与逻辑重点题型全梳理.pdf',
        data: 'base64-pdf',
      });
      expect(request.llmTarget.id).toBe('openai-chat-gemini-3.1-pro');
      expect(request.pagePrompt({ pageNumber: 1, totalPages: 2 })).toContain('id=kp-set-mutual');
      expect(
        request.finalPrompt({
          pageResults: [{ page_number: 1, text: '含参问题回代检验互异性' }],
        }),
      ).toContain('id=kp-set-mutual');

      return {
        document_type: 'mixed_learning_material',
        target_id: request.llmTarget.id,
        provider: request.llmTarget.provider,
        model: request.llmTarget.model,
        api_shape: request.llmTarget.api_shape,
        ok: true,
        pages: [{ page_number: 1, ok: true, text: '含参问题回代检验互异性', latency_ms: 10 }],
        source_document: {
          source_type: 'lesson_handout',
          title: '集合与逻辑重点题型全梳理',
          subject_name: '高中数学',
          stage: 'senior',
          provider: '高途',
          year: 2024,
          season: '秋季',
          page_count: 1,
        },
        source_units: [],
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
            student_summary: '求出参数后先回代。',
            content_origin: 'model_summary',
            kp_hints: ['集合中元素的互异性'],
            source_ref: { page: 1, question_no: '例题2' },
            confidence: 0.9,
          },
        ],
        questions: [],
        parse_error: 'No JSON object found in model output.',
        fallback_used: 'page_results',
      };
    });

    const result = await analyzeMixedLearningMaterial({
      providerId: 'openai-chat-gemini-3.1-pro',
      subjectName: '高中数学',
      file: {
        type: 'pdf',
        name: '集合与逻辑重点题型全梳理.pdf',
        data: 'base64-pdf',
      },
      knowledge: [
        {
          id: 'kp-set-mutual',
          name: '集合中元素的互异性',
          chapter_title: '集合与常用逻辑用语',
          description: '集合中的元素不能重复。',
        },
      ],
      parsePdfMixedLearningMaterialImpl,
    });

    expect(parsePdfMixedLearningMaterialImpl).toHaveBeenCalledTimes(1);
    expect(result.source_document.source_type).toBe('lesson_handout');
    expect(result.learning_materials[0]?.source_ref.page).toBe(1);
    expect(result.knowledge_source).toEqual({
      count: 1,
      source_type: 'knowledge_list',
    });
    expect(result.parse_error).toBe('No JSON object found in model output.');
    expect(result.fallback_used).toBe('page_results');
    expect(result.diagnostics?.fallback_used).toBe('page_results');
  });

  it('accepts direct llmTarget/apiKey for mixed learning material verification', async () => {
    const parsePdfMixedLearningMaterialImpl = vi.fn(async (request) => {
      expect(request.apiKey).toBe('direct-token');
      expect(request.llmTarget).toEqual(
        expect.objectContaining({
          id: 'openai-chat-gemini-3-5-flash-global',
          provider: 'openai',
          api_shape: 'openai-chat-completions',
          model: 'google.gemini-3.5-flash-global',
        }),
      );
      expect(request.pdf).toEqual({
        name: '集合与逻辑重点题型全梳理.pdf',
        data: 'base64-pdf',
      });

      return {
        document_type: 'mixed_learning_material',
        target_id: request.llmTarget.id,
        provider: request.llmTarget.provider,
        model: request.llmTarget.model,
        api_shape: request.llmTarget.api_shape,
        ok: true,
        pages: [{ page_number: 1, ok: true, text: '含参问题回代检验互异性', latency_ms: 10 }],
        source_document: {
          source_type: 'lesson_handout',
          title: '集合与逻辑重点题型全梳理',
          subject_name: '高中数学',
          stage: 'senior',
          provider: '高途',
          page_count: 1,
        },
        source_units: [],
        knowledge_points: [],
        learning_materials: [],
        questions: [],
        parse_error: null,
      };
    });

    const result = await analyzeMixedLearningMaterial({
      llmTarget: {
        id: 'openai-chat-gemini-3-5-flash-global',
        provider: 'openai',
        api_shape: 'openai-chat-completions',
        model: 'google.gemini-3.5-flash-global',
        path: '/openai/v1/chat/completions',
      },
      apiKey: 'direct-token',
      subjectName: '高中数学',
      file: {
        type: 'pdf',
        name: '集合与逻辑重点题型全梳理.pdf',
        data: 'base64-pdf',
      },
      parsePdfMixedLearningMaterialImpl,
    });

    expect(findUnique).not.toHaveBeenCalled();
    expect(parsePdfMixedLearningMaterialImpl).toHaveBeenCalledTimes(1);
    expect(result.llm?.target_id).toBe('openai-chat-gemini-3-5-flash-global');
  });

  it('uses analyzeLearningResource as the unified knowledge-thread entry', async () => {
    findUnique.mockResolvedValue(OPENAI_PROVIDER);
    const parsePdfMixedLearningMaterialImpl = vi.fn(async (request) => {
      expect(request.providerId).toBeUndefined();
      expect(request.apiKey).toBe('test-token-xyz');
      expect(request.subjectName).toBe('高中数学');
      expect(request.pagePrompt({ pageNumber: 1, totalPages: 1 })).toContain('id=kp-set-mutual');

      return {
        document_type: 'mixed_learning_material',
        target_id: request.llmTarget.id,
        provider: request.llmTarget.provider,
        model: request.llmTarget.model,
        api_shape: request.llmTarget.api_shape,
        ok: true,
        pages: [{ page_number: 1, ok: true, text: '逐页 JSON', latency_ms: 10 }],
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
          page_count: 1,
        },
        source_units: [
          {
            unit_kind: 'text_block',
            page_no: 1,
            text_snippet: '扫码关注课程顾问领取资料',
          },
        ],
        knowledge_points: [],
        learning_materials: [
          {
            material_type: 'common_mistake',
            title: '含参问题回代检验互异性',
            content: '含参集合问题求出参数后，需要回代检查元素互异性。',
            student_summary: '求出参数后先回代。',
            content_origin: 'source_extract',
            kp_hints: ['集合中元素的互异性'],
            source_ref: { page: 1, slide_no: 3 },
            confidence: 0.9,
          },
          {
            material_type: 'study_advice',
            title: '课程优惠提醒',
            content: '扫码关注课程顾问领取优惠。',
            student_summary: '',
            content_origin: 'source_extract',
            kp_hints: [],
            source_ref: { page: 1, text_snippet: '扫码关注课程顾问领取优惠' },
            confidence: 0.95,
          },
        ],
        questions: [
          {
            content: '已知集合 A，求参数 a。',
            question_type: 'fill_in',
            options: [],
            answer: '',
            solution_text: '',
            difficulty: 2,
            kp_hints: ['集合中元素的互异性'],
            quality_status: 'missing_answer',
            source_ref: { page: 1, slide_no: 2, question_no: '例题2' },
          },
        ],
        parse_error: 'No JSON object found in model output.',
        validation_error: null,
        fallback_used: 'page_results',
        payload_log_path: 'payload-log.txt',
      };
    });

    const result = await analyzeLearningResource({
      providerId: 'openai-chat-gemini-3.1-pro',
      subjectName: '高中数学',
      file: {
        type: 'pdf',
        name: '集合与逻辑重点题型全梳理.pdf',
        data: 'base64-pdf',
      },
      knowledge: [
        {
          id: 'kp-set-mutual',
          name: '集合中元素的互异性',
          chapter_title: '集合与常用逻辑用语',
          description: '集合中的元素不能重复。',
        },
      ],
      parsePdfMixedLearningMaterialImpl,
    });

    expect(parsePdfMixedLearningMaterialImpl).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('learning_resource');
    expect(result.knowledge_threads).toHaveLength(1);
    expect(result.knowledge_threads[0]?.knowledge_point.id).toBe('kp-set-mutual');
    expect(result.knowledge_threads[0]?.common_mistakes[0]?.title).toBe('含参问题回代检验互异性');
    expect(result.knowledge_threads[0]?.questions[0]?.answer).toBe('');
    expect(result.knowledge_threads[0]?.questions[0]?.quality_status).toBe('missing_answer');
    expect(result.filtered_items_summary.categories).toEqual(
      expect.arrayContaining(['advertisement', 'qr_code']),
    );
    expect(result.diagnostics.fallback_used).toBe('page_results');
  });
});
