import { describe, expect, it, vi } from 'vitest';

import {
  QUESTION_ANSWER_DRAFT_PROMPT_VERSION,
  buildQuestionAnswerDraftPrompt,
  generateQuestionAnswerDraft,
  parseQuestionAnswerDraftText,
  questionAnswerDraftSchema,
} from './question-answer-draft.ts';

const TARGET = {
  id: 'openai-chat-gemini-3-5-flash-global',
  provider: 'openai_chat',
  api_shape: 'openai-chat-completions',
  model: 'google.gemini-3.5-flash-global',
  path: 'https://example.com/openai/v1/chat/completions',
};

const TARGET_CONFIG = {
  targets: [TARGET],
};

describe('question answer draft generation', () => {
  it('builds a prompt that constrains admin-only JSON draft output', () => {
    const prompt = buildQuestionAnswerDraftPrompt({
      question: {
        content: '已知集合 A={1,2}, B={2,3}，则 A∪B=？',
        question_type: 'choice',
        options: [
          { label: 'A', text: '{1,2}' },
          { label: 'B', text: '{1,2,3}' },
        ],
        subjectName: '高中数学',
      },
      knowledge: [{ name: '集合的并集' }],
    });

    expect(QUESTION_ANSWER_DRAFT_PROMPT_VERSION).toBe(
      'question/common/generateQuestionAnswerDraft',
    );
    expect(prompt).toContain('admin 审核辅助草稿');
    expect(prompt).toContain('只返回 JSON');
    expect(prompt).toContain('不要用 Markdown');
    expect(prompt).toContain('不得声称答案来自原文');
    expect(prompt).toContain('不要输出 quality_status');
    expect(prompt).toContain('选择题 answer 返回选项字母');
    expect(prompt).toContain('集合的并集');
  });

  it('validates the strict public draft schema', () => {
    const valid = questionAnswerDraftSchema.safeParse({
      kind: 'question_answer_draft',
      answer: 'B. {1,2,3}',
      solution_text: '并集包含属于 A 或属于 B 的所有元素，所以 A∪B={1,2,3}。',
      confidence: 0.92,
      warnings: [],
      prompt_version: QUESTION_ANSWER_DRAFT_PROMPT_VERSION,
    });
    expect(valid.success).toBe(true);

    const forbidden = questionAnswerDraftSchema.safeParse({
      kind: 'question_answer_draft',
      answer: 'B',
      solution_text: '略',
      confidence: 0.8,
      warnings: [],
      prompt_version: QUESTION_ANSWER_DRAFT_PROMPT_VERSION,
      quality_status: 'publishable',
    });
    expect(forbidden.success).toBe(false);
  });

  it('returns a validated choice answer draft and strips source-like fields', async () => {
    const callLlmImpl = vi.fn(async (request) => {
      expect(request.requestLabel).toBe(QUESTION_ANSWER_DRAFT_PROMPT_VERSION);
      expect(request.input).toContain('admin 审核辅助草稿');
      expect(Object.hasOwn(request, 'maxTokens')).toBe(false);
      return {
        ok: true,
        text: JSON.stringify({
          kind: 'question_answer_draft',
          answer: 'B. {1,2,3}',
          solution_text: 'A∪B 表示属于 A 或属于 B 的元素组成的集合，合并去重得 {1,2,3}。',
          confidence: '0.93',
          warnings: [],
          prompt_version: QUESTION_ANSWER_DRAFT_PROMPT_VERSION,
          quality_status: 'publishable',
          answer_source: 'source_extract',
        }),
      };
    });

    const result = await generateQuestionAnswerDraft({
      llmTarget: TARGET,
      question: {
        content: '已知集合 A={1,2}, B={2,3}，则 A∪B=？',
        question_type: 'choice',
        options: [
          { label: 'A', text: '{1,2}' },
          { label: 'B', text: '{1,2,3}' },
          { label: 'C', text: '{2}' },
          { label: 'D', text: '{3}' },
        ],
        kp_hints: ['集合的并集'],
        subjectName: '高中数学',
      },
      knowledge: [{ name: '集合的并集', brief: '由属于任一集合的元素组成。' }],
      maxTokens: null,
      callLlmImpl,
    });

    expect(callLlmImpl).toHaveBeenCalledTimes(1);
    expect(Object.keys(result).sort()).toEqual([
      'answer',
      'confidence',
      'kind',
      'prompt_version',
      'solution_text',
      'warnings',
    ]);
    expect(result).toEqual({
      kind: 'question_answer_draft',
      answer: 'B. {1,2,3}',
      solution_text: 'A∪B 表示属于 A 或属于 B 的元素组成的集合，合并去重得 {1,2,3}。',
      confidence: 0.93,
      warnings: [],
      prompt_version: QUESTION_ANSWER_DRAFT_PROMPT_VERSION,
    });
    expect(result).not.toHaveProperty('quality_status');
    expect(result).not.toHaveProperty('answer_source');
    expect(questionAnswerDraftSchema.safeParse(result).success).toBe(true);
  });

  it('returns a validated fill-in answer draft', async () => {
    const result = await generateQuestionAnswerDraft({
      llmConfig: TARGET_CONFIG,
      targetId: TARGET.id,
      question: {
        content: '若 2x+1=7，则 x=____。',
        question_type: 'fill_in',
        options: [],
        subjectName: '初中数学',
      },
      callLlmImpl: async () => ({
        ok: true,
        text: JSON.stringify({
          answer: '3',
          solution_text: '由 2x+1=7 得 2x=6，所以 x=3。',
          confidence: 0.98,
          warnings: [],
          prompt_version: QUESTION_ANSWER_DRAFT_PROMPT_VERSION,
        }),
      }),
    });

    expect(result.answer).toBe('3');
    expect(result.solution_text).toContain('x=3');
    expect(result.prompt_version).toBe(QUESTION_ANSWER_DRAFT_PROMPT_VERSION);
    expect(questionAnswerDraftSchema.safeParse(result).success).toBe(true);
  });

  it('repairs one non-JSON model output before returning a draft', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const result = await generateQuestionAnswerDraft({
      llmTarget: TARGET,
      question: {
        content: '已知集合 A={1,2}, B={2,3}，则 A∪B=？',
        question_type: 'choice',
        options: [
          { label: 'A', text: '{1,2}' },
          { label: 'B', text: '{1,2,3}' },
        ],
      },
      callLlmImpl: async (request: Record<string, unknown>) => {
        calls.push(request);
        if (calls.length === 1) {
          return {
            ok: true,
            text: '答案选 B，因为并集是 {1,2,3}。',
          };
        }
        expect(String(request.input)).toContain('上一次模型输出不是可解析 JSON');
        expect(String(request.input)).toContain('答案选 B');
        expect(request.requestLabel).toBe(`${QUESTION_ANSWER_DRAFT_PROMPT_VERSION}:repair-json`);
        return {
          ok: true,
          text: JSON.stringify({
            kind: 'question_answer_draft',
            answer: 'B. {1,2,3}',
            solution_text: '并集包含属于 A 或属于 B 的元素，所以 A∪B={1,2,3}。',
            confidence: 0.95,
            warnings: [],
            prompt_version: QUESTION_ANSWER_DRAFT_PROMPT_VERSION,
          }),
        };
      },
    });

    expect(calls).toHaveLength(2);
    expect(result.answer).toBe('B. {1,2,3}');
    expect(result.warnings).toEqual([]);
    expect(questionAnswerDraftSchema.safeParse(result).success).toBe(true);
  });

  it('reports LLM call failure without JSON parse noise', async () => {
    const result = await generateQuestionAnswerDraft({
      llmTarget: TARGET,
      question: {
        content: '已知集合 A={1,2}, B={2,3}，则 A∪B=？',
        question_type: 'choice',
        options: [
          { label: 'A', text: '{1,2}' },
          { label: 'B', text: '{1,2,3}' },
        ],
      },
      callLlmImpl: async () => ({
        ok: false,
        text: '',
        error_message: 'fetch failed',
      }),
    });

    expect(result.answer).toBe('');
    expect(result.solution_text).toBe('');
    expect(result.warnings.some((warning) => /LLM 调用失败/.test(warning))).toBe(true);
    expect(result.warnings.some((warning) => /JSON/.test(warning))).toBe(false);
    expect(questionAnswerDraftSchema.safeParse(result).success).toBe(true);
  });

  it('returns warnings without calling LLM when the stem is incomplete', async () => {
    const callLlmImpl = vi.fn();
    const result = await generateQuestionAnswerDraft({
      question: {
        content: '【在这里粘贴题干】',
        question_type: 'choice',
        options: [{ label: 'A', text: '1' }],
      },
      callLlmImpl,
    });

    expect(callLlmImpl).not.toHaveBeenCalled();
    expect(result.answer).toBe('');
    expect(result.solution_text).toBe('');
    expect(result.warnings.some((warning) => /题干/.test(warning))).toBe(true);
    expect(questionAnswerDraftSchema.safeParse(result).success).toBe(true);
  });

  it('returns warnings without calling LLM when a choice question has no options', async () => {
    const callLlmImpl = vi.fn();
    const result = await generateQuestionAnswerDraft({
      question: {
        content: '已知集合 A={1,2}, B={2,3}，则 A∪B=？',
        question_type: 'choice',
        options: [],
      },
      callLlmImpl,
    });

    expect(callLlmImpl).not.toHaveBeenCalled();
    expect(result.answer).toBe('');
    expect(result.solution_text).toBe('');
    expect(result.warnings.some((warning) => /选择题缺少选项/.test(warning))).toBe(true);
    expect(questionAnswerDraftSchema.safeParse(result).success).toBe(true);
  });

  it('returns warnings without calling LLM when visual context is missing', async () => {
    const callLlmImpl = vi.fn();
    const result = await generateQuestionAnswerDraft({
      question: {
        content: '如图，函数图象与 x 轴交于 A、B 两点，求 AB 的长度。',
        question_type: 'fill_in',
      },
      callLlmImpl,
    });

    expect(callLlmImpl).not.toHaveBeenCalled();
    expect(result.answer).toBe('');
    expect(result.solution_text).toBe('');
    expect(result.warnings.some((warning) => /图片\/图表信息/.test(warning))).toBe(true);
    expect(questionAnswerDraftSchema.safeParse(result).success).toBe(true);
  });

  it('normalizes invalid or truncated model output into a strict empty draft', () => {
    const result = parseQuestionAnswerDraftText('```json\n{"answer":"A"');

    expect(result.kind).toBe('question_answer_draft');
    expect(result.answer).toBe('');
    expect(result.solution_text).toBe('');
    expect(result.confidence).toBeNull();
    expect(result.warnings.some((warning) => /JSON/.test(warning))).toBe(true);
    expect(result.prompt_version).toBe(QUESTION_ANSWER_DRAFT_PROMPT_VERSION);
    expect(questionAnswerDraftSchema.safeParse(result).success).toBe(true);
  });
});
