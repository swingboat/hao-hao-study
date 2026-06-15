import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findUnique = vi.fn();

vi.mock('@hao/db', () => ({
  prisma: {
    llm_provider: {
      findUnique: (args: unknown) => findUnique(args),
    },
  },
}));

const { analyzeKnowledgePoints, analyzeQuestions } = await import('./index');

const OPENAI_PROVIDER = {
  id: 'webex-gemini-3.1-pro',
  protocol: 'openai_chat',
  endpoint: 'https://example.com/openai/v1/chat/completions',
  model: 'google.gemini-3.1-pro-global',
  capabilities: { text: true, vision: true },
  auth_env_var: 'WEBEX_LLM_TOKEN',
  default_params: { temperature: 0.2 },
  max_output_tokens: null,
  quirks: {},
  output_normalizers: [],
  enabled: true,
};

beforeEach(() => {
  process.env.WEBEX_LLM_TOKEN = 'test-token-xyz';
  findUnique.mockReset();
});

afterEach(() => {
  delete process.env.WEBEX_LLM_TOKEN;
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
          id: 'webex-gemini-3.1-pro',
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
      providerId: 'webex-gemini-3.1-pro',
      file: {
        type: 'pdf',
        name: 'textbook.pdf',
        data: 'base64-pdf',
      },
      parsePdfKnowledgePointsImpl,
    });

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'webex-gemini-3.1-pro' } });
    expect(parsePdfKnowledgePointsImpl).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('knowledge_points');
    expect(result.llm).toEqual({
      llm_target_id: 'webex-gemini-3.1-pro',
      target_id: 'webex-gemini-3.1-pro',
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
      expect(request.llmTarget.id).toBe('webex-gemini-3.1-pro');
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
      providerId: 'webex-gemini-3.1-pro',
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
    expect(result.llm.target_id).toBe('webex-gemini-3.1-pro');
    expect(result.questions[0]?.id).toBe(9);
  });
});
