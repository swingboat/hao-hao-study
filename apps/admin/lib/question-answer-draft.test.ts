import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildQuestionAnswerDraftRequest,
  canApplyQuestionAnswerDraft,
  isMissingAnswerDraftCandidate,
  requestQuestionAnswerDraft,
} from './question-answer-draft.ts';

const missingAnswerPayload = {
  content: ['集合 A 中含有元素 4，则 a 的值为（ ）', 'A. -1', 'B. 3'].join('\n'),
  question_type: 'choice',
  options: [
    { label: 'A', text: '-1' },
    { label: 'B', text: '3' },
  ],
  answer: '',
  solution_text: '',
  kp_hints: ['集合与元素'],
  quality_status: 'missing_answer',
  source_ref: { page: 3, question_no: '例题2' },
};

test('buildQuestionAnswerDraftRequest forwards providerId and staging question to public draft method', () => {
  const knowledge = [{ id: 'kp-1', name: '集合与元素' }];
  const request = buildQuestionAnswerDraftRequest({
    providerId: 'provider-db-id',
    payload: missingAnswerPayload,
    subjectName: '高中数学',
    knowledge,
  });

  assert.equal(request.providerId, 'provider-db-id');
  assert.equal(request.maxTokens, 1800);
  assert.equal(request.knowledge, knowledge);
  assert.deepEqual(request.question, {
    content: '集合 A 中含有元素 4，则 a 的值为（ ）',
    question_type: 'choice',
    options: missingAnswerPayload.options,
    answer: '',
    solution_text: '',
    kp_hints: ['集合与元素'],
    subjectName: '高中数学',
    source_ref: { page: 3, question_no: '例题2' },
  });
});

test('requestQuestionAnswerDraft calls injected public draft method without changing missing_answer payload', async () => {
  let calledWith: unknown = null;
  const draft = await requestQuestionAnswerDraft({
    providerId: 'provider-db-id',
    payload: missingAnswerPayload,
    subjectName: '高中数学',
    generateDraft: async (request) => {
      calledWith = request;
      return {
        kind: 'question_answer_draft',
        status: 'ok',
        answer: 'B',
        solution_text: '代入条件计算。',
        confidence: 0.8,
        warnings: [],
        prompt_version: 'question/common/generateQuestionAnswerDraft',
        draft_source: 'ai_generated_review_draft',
        llm: {},
        diagnostics: { parse_error: null, validation_error: null, payload_log_path: '' },
      };
    },
  });

  assert.equal((calledWith as { providerId?: string }).providerId, 'provider-db-id');
  assert.equal(draft.answer, 'B');
  assert.equal(missingAnswerPayload.answer, '');
  assert.equal(missingAnswerPayload.quality_status, 'missing_answer');
});

test('isMissingAnswerDraftCandidate only allows missing_answer questions with empty answer', () => {
  assert.equal(isMissingAnswerDraftCandidate(missingAnswerPayload), true);
  assert.equal(isMissingAnswerDraftCandidate({ ...missingAnswerPayload, answer: 'B' }), false);
  assert.equal(
    isMissingAnswerDraftCandidate({
      ...missingAnswerPayload,
      quality_status: 'needs_human_review',
    }),
    false,
  );
});

test('canApplyQuestionAnswerDraft blocks warnings or empty answers', () => {
  assert.equal(canApplyQuestionAnswerDraft({ answer: 'B', warnings: [] }), true);
  assert.equal(canApplyQuestionAnswerDraft({ answer: '', warnings: [] }), false);
  assert.equal(canApplyQuestionAnswerDraft({ answer: 'B', warnings: ['题干不完整'] }), false);
});

test('review UI labels generated answer as AI reference draft', () => {
  const drawerSource = readFileSync(
    new URL('../app/admin/questions/import/[uploadId]/diff-drawer.tsx', import.meta.url),
    'utf8',
  );
  const rowSource = readFileSync(
    new URL('../app/admin/questions/import/[uploadId]/staging-row.tsx', import.meta.url),
    'utf8',
  );

  assert.match(drawerSource, /AI 生成参考解答草稿/);
  assert.match(drawerSource, /参考解答草稿 \/ AI 生成，仅供审核/);
  assert.match(drawerSource, /题干 \*/);
  assert.match(drawerSource, /答案 \*/);
  assert.match(drawerSource, /解析/);
  assert.match(drawerSource, /可换模型重试/);
  assert.match(drawerSource, /主知识点/);
  assert.match(rowSource, /AI 生成参考解答/);
  assert.match(rowSource, /知识点线索/);
  assert.match(rowSource, /isMissingAnswerDraftCandidate/);
  assert.doesNotMatch(
    drawerSource,
    /<Block label="(?:content|answer|solution_text)"|<Field label="(?:content|answer|solution_text)|difficulty \*\s*\(1-5\)|title="设为 primary"|换模型重跑（F3\.6 \/ T7）/,
  );
  assert.doesNotMatch(`${drawerSource}\n${rowSource}`, /原文答案/);
});

test('server action uses public answer draft entry without lower-level LLM wiring', () => {
  const source = readFileSync(
    new URL('../app/admin/questions/import/[uploadId]/actions.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /generateAnswerDraftAction/);
  assert.match(source, /generateQuestionAnswerDraft/);
  assert.doesNotMatch(source, /llm-client|document-parser|buildQuestionAnswerDraftPrompt/);
});
