import { describe, expect, it, vi } from 'vitest';

import { analyzeKnowledgePoints, analyzeQuestions } from './index';

describe('@hao/llm education analysis common API', () => {
  it('analyzeKnowledgePoints returns the common knowledge_points result shape', async () => {
    const parsePdfKnowledgePointsImpl = vi.fn(async (request) => {
      expect(request.providerId).toBe('webex-gemini-3.1-pro');
      expect(request.file).toEqual({
        type: 'pdf',
        name: 'textbook.pdf',
        data: 'base64-pdf',
      });
      return {
        document_type: 'pdf',
        target_id: request.providerId,
        provider: request.providerId,
        model: 'google.gemini-3.1-pro-global',
        api_shape: 'openai_chat',
        ok: true,
        pages: [
          { page_number: 1, ok: true, text: '第一页', latency_ms: 10 },
          { page_number: 2, ok: true, text: '第二页', latency_ms: 20 },
        ],
        coverage_summary: {
          input_candidate_count: 3,
          output_knowledge_point_count: 1,
          expected_range: '100-180',
          coverage_notes: ['测试教材较短。'],
        },
        chapters: [
          {
            number: '第一章',
            title: '集合',
            sections: [
              {
                number: '1.1',
                title: '集合的概念',
                knowledge_points: [
                  {
                    id: 7,
                    name: '元素与集合',
                    description: '理解元素与集合的关系。',
                    formulas: ['a ∈ A'],
                    source_pages: [1],
                  },
                ],
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

    expect(parsePdfKnowledgePointsImpl).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('knowledge_points');
    expect(result.status).toBe('ok');
    expect(result.source).toEqual({ type: 'pdf', name: 'textbook.pdf', page_count: 2 });
    expect(result.llm).toEqual({
      target_id: 'webex-gemini-3.1-pro',
      provider: 'webex-gemini-3.1-pro',
      model: 'google.gemini-3.1-pro-global',
      api_shape: 'openai_chat',
    });
    expect(result.chapters[0]?.id).toBe('ch-1');
    expect(result.chapters[0]?.sections?.[0]?.id).toBe('sec-1-1');
    expect(result.chapters[0]?.sections?.[0]?.knowledge_points?.[0]?.id).toBe('7');
    expect(result.knowledge_points[0]?.id).toBe('7');
    expect(result.coverage).toEqual({
      input_candidate_count: 3,
      output_knowledge_point_count: 1,
      expected_range: '100-180',
      notes: ['测试教材较短。'],
    });
  });

  it('analyzeQuestions routes Word documents and prefixes multiple knowledge sources', async () => {
    const parsePdfQuestionsImpl = vi.fn(async () => {
      throw new Error('PDF parser should not be called for Word files');
    });
    const parseWordQuestionsImpl = vi.fn(async (request) => {
      expect(request.providerId).toBe('webex-gemini-3.1-pro');
      expect(request.file.type).toBe('word');
      expect(request.knowledgeContext).toContain('id=ks1-kp-1');
      expect(request.knowledgeContext).toContain('id=ks2-kp-1');
      expect(request.knowledgeContext).toContain('source=数学必修第一册.pdf');
      expect(request.knowledgeContext).toContain('source=数学必修第二册.pdf');
      return {
        document_type: 'word',
        target_id: request.providerId,
        provider: request.providerId,
        model: 'google.gemini-3.1-pro-global',
        api_shape: 'openai_chat',
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
            related_knowledge_points: [
              {
                id: 'ks1-kp-1',
                name: '元素与集合',
                chapter: '第一章 集合',
                section: '1.1 集合的概念',
                confidence: 0.91,
                reason: '考查元素与集合关系。',
              },
            ],
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
        {
          kind: 'knowledge_points',
          source: { name: '数学必修第二册.pdf' },
          knowledge_points: [{ id: 'kp-1', name: '空间几何体' }],
        },
      ],
      parsePdfQuestionsImpl,
      parseWordQuestionsImpl,
    });

    expect(parsePdfQuestionsImpl).not.toHaveBeenCalled();
    expect(parseWordQuestionsImpl).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('questions');
    expect(result.status).toBe('ok');
    expect(result.source).toEqual({ type: 'word', name: 'questions.docx', page_count: 1 });
    expect(result.knowledge_source).toEqual({
      count: 2,
      source_type: 'knowledge_collection',
    });
    expect(result.questions[0]?.id).toBe('9');
    expect(result.questions[0]?.related_knowledge_points[0]?.id).toBe('ks1-kp-1');
  });
});
