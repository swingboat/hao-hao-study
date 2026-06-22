import { describe, expect, it, vi } from 'vitest';

import {
  QUESTION_ANSWER_DRAFT_PROMPT_VERSION,
  buildQuestionAnswerDraftPrompt,
  generateQuestionAnswerDraft,
  parseQuestionAnswerDraftText,
  questionAnswerDraftSchema,
} from './question-answer-draft.ts';

const TARGET = {
  id: 'openai-chat-gemini-3.1-pro',
  provider: 'openai_chat',
  api_shape: 'openai-chat-completions',
  model: 'google.gemini-3.1-pro-global',
  path: 'https://example.com/openai/v1/chat/completions',
};

describe('question answer draft generation', () => {
  it('normalizes a choice draft with answer and solution_text', () => {
    const parsed = parseQuestionAnswerDraftText(
      JSON.stringify({
        answer: 'C. 充分不必要条件',
        solution_text: '由 p 可以推出 q，但 q 不能推出 p，所以是充分不必要条件。',
        confidence: 0.86,
        warnings: [],
        answer_source: 'source_extract',
        quality_status: 'publishable',
      }),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.draft).toEqual({
      answer: 'C. 充分不必要条件',
      solution_text: '由 p 可以推出 q，但 q 不能推出 p，所以是充分不必要条件。',
      confidence: 0.86,
      warnings: [],
    });
    expect(questionAnswerDraftSchema.safeParse(parsed.draft).success).toBe(true);
    expect(parsed.draft).not.toHaveProperty('answer_source');
    expect(parsed.draft).not.toHaveProperty('quality_status');
  });

  it('returns warnings and empty answer without calling LLM when a choice question has no options', async () => {
    const callLlmImpl = vi.fn();

    const result = await generateQuestionAnswerDraft({
      llmTarget: TARGET,
      apiKey: 'test-token',
      question: {
        content: '下列说法正确的是？',
        question_type: 'choice',
        options: [],
        answer: '',
        solution_text: '',
      },
      callLlmImpl,
    });

    expect(callLlmImpl).not.toHaveBeenCalled();
    expect(result.kind).toBe('question_answer_draft');
    expect(result.answer).toBe('');
    expect(result.solution_text).toBe('');
    expect(result.confidence).toBeNull();
    expect(result.prompt_version).toBe(QUESTION_ANSWER_DRAFT_PROMPT_VERSION);
    expect(result.warnings).toEqual(
      expect.arrayContaining(['选择题缺少选项，无法可靠生成参考答案。']),
    );
    expect(result.draft_source).toBe('ai_generated_review_draft');
    expect(result).not.toHaveProperty('quality_status');
  });

  it('builds a prompt that identifies the output as an admin review draft', () => {
    const prompt = buildQuestionAnswerDraftPrompt({
      question: {
        content: '若 x^2=4，求 x。',
        question_type: 'fill_in',
        options: [],
        kp_hints: ['一元二次方程'],
        subjectName: '高中数学',
      },
      knowledge: [{ name: '平方根', description: '正负两个平方根都要考虑。' }],
    });

    expect(QUESTION_ANSWER_DRAFT_PROMPT_VERSION).toBe(
      'question/common/generateQuestionAnswerDraft',
    );
    expect(prompt).toContain('审核辅助草稿');
    expect(prompt).toContain('不得声称答案来自原文');
    expect(prompt).toContain('如果题干不完整、选项缺失、图片信息不足');
    expect(prompt).toContain('"answer"');
    expect(prompt).toContain('"solution_text"');
    expect(prompt).toContain('question/common/generateQuestionAnswerDraft');
  });
});
