import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSessionReviewAdviceInput,
  generateAndPersistSessionReviewAdviceFromContext,
  readPersistedSessionReviewAdvice,
  selectSessionResultReviewPlan,
} from './session-review-advice.ts';

const deterministicPlan = {
  headline: '先把“充分条件与必要条件”补牢',
  summary: '答对 2 / 6，先看易错提醒和解题方法。',
  steps: ['先处理易错点', '再看解题方法', '最后回到错题解析'],
  focusItems: [
    {
      kpId: 'kp-a',
      knowledgePointName: '充分条件与必要条件',
      priorityLabel: '优先巩固',
      scoreText: '本次 1 / 2',
      suggestion: '先看易错提醒。',
      recommendedLabels: ['易错提醒'],
    },
  ],
};

const llmAdvice = {
  headline: '先把条件关系的方向感找回来',
  summary: '这次主要卡在充分条件与必要条件的推出方向上。',
  focusItems: [
    {
      knowledgePointName: '充分条件与必要条件',
      priorityLabel: '优先巩固',
      reason: '两道相关题只答对一道，说明方向判断还不稳。',
      suggestedAction: '先复述 A 推 B 和 B 推 A 的区别，再回看错题解析。',
      recommendedMaterialTypes: ['common_mistake', 'method_card'],
    },
  ],
  nextSteps: ['先看易错提醒', '再做错题复盘', '最后口述判断步骤'],
  encouragement: '这类题只要方向稳定，正确率会很快上来。',
  qualityFlags: ['history_insufficient'],
};

test('builds session review advice input without internal ids or enum-only labels', () => {
  const input = buildSessionReviewAdviceInput({
    sessionId: 'session-1',
    studentId: 'student-1',
    subjectId: 'subject-math',
    student: {
      grade: 'senior2',
      stage: 'senior_high',
      targetExam: '高考',
    },
    session: {
      correctCount: 2,
      totalCount: 6,
      isMistakeReview: true,
      completedAt: new Date('2026-06-22T01:00:00Z'),
    },
    attempts: [
      {
        questionSummary: '若 p 是 q 的充分条件，判断集合关系。',
        solutionSummary: '从集合包含关系判断推出方向。',
        studentAnswer: 'A',
        correctAnswer: 'B',
        isCorrect: false,
        knowledgePointNames: ['充分条件与必要条件'],
      },
    ],
    knowledgeGroups: [
      {
        knowledgePointName: '充分条件与必要条件',
        status: 'needs_work',
        correctCount: 1,
        totalCount: 2,
        materials: [
          {
            materialType: 'common_mistake',
            label: '易错提醒',
            title: '方向别看反',
            summary: '注意 A 是 B 的充分条件和 A 的充分条件是 B 的区别。',
          },
        ],
      },
    ],
    mastery: [
      {
        knowledgePointName: '充分条件与必要条件',
        masteryScore: 0.42,
        peakMasteryScore: 0.62,
        lastAttemptedAt: new Date('2026-06-22T01:00:00Z'),
        openMistakeCount: 1,
        totalErrorCount: 3,
      },
    ],
    deterministicPlan,
  });

  assert.equal(input.session.correctCount, 2);
  assert.equal(input.session.isMistakeReview, true);
  assert.equal(input.knowledgeGroups[0]?.materials[0]?.label, '易错提醒');
  assert.equal(input.knowledgeGroups[0]?.materials[0]?.materialType, 'common_mistake');
  assert.doesNotMatch(JSON.stringify(input), /kp-a|question_id|provider|job|source_document_id/);
});

test('generates and upserts persisted advice when provider and LLM result are available', async () => {
  const upserts: unknown[] = [];
  const result = await generateAndPersistSessionReviewAdviceFromContext({
    context: sampleContext(),
    providerId: 'provider-main',
    generate: async ({ providerId, input }) => {
      assert.equal(providerId, 'provider-main');
      assert.equal(input.session.correctCount, 2);
      return {
        kind: 'session_review_advice',
        status: 'ok',
        advice: llmAdvice,
        llm: { provider: 'openai', model: 'review-model' },
        diagnostics: { parse_error: null, validation_error: null, payload_log_path: '' },
        usage: { total_tokens: 123 },
        latency_ms: 456,
      };
    },
    upsert: async (payload) => {
      upserts.push(payload);
    },
    now: () => new Date('2026-06-22T02:00:00Z'),
  });

  assert.equal(result.status, 'generated');
  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0], {
    sessionId: 'session-1',
    studentId: 'student-1',
    subjectId: 'subject-math',
    status: 'generated',
    advice: llmAdvice,
    inputSnapshot: buildSessionReviewAdviceInput(sampleContext()),
    deterministicPlan,
    llmMetadata: {
      llm: { provider: 'openai', model: 'review-model' },
      usage: { total_tokens: 123 },
      latency_ms: 456,
      status: 'ok',
    },
    diagnostics: { parse_error: null, validation_error: null, payload_log_path: '' },
    qualityFlags: ['history_insufficient'],
    errorMessage: null,
    generatedAt: new Date('2026-06-22T02:00:00Z'),
  });
});

test('upserts failed advice and keeps deterministic plan when provider is missing', async () => {
  const upserts: unknown[] = [];
  const result = await generateAndPersistSessionReviewAdviceFromContext({
    context: sampleContext(),
    providerId: null,
    generate: async () => {
      throw new Error('should not call LLM without provider');
    },
    upsert: async (payload) => {
      upserts.push(payload);
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal((upserts[0] as { status: string }).status, 'failed');
  assert.equal((upserts[0] as { advice: unknown }).advice, null);
  assert.deepEqual(
    (upserts[0] as { deterministicPlan: unknown }).deterministicPlan,
    deterministicPlan,
  );
  assert.match(
    (upserts[0] as { errorMessage: string }).errorMessage,
    /HAO_SESSION_REVIEW_PROVIDER_ID/,
  );
});

test('upserts failed advice and keeps deterministic plan when LLM throws', async () => {
  const upserts: unknown[] = [];
  const result = await generateAndPersistSessionReviewAdviceFromContext({
    context: sampleContext(),
    providerId: 'provider-main',
    generate: async () => {
      throw new Error('timeout');
    },
    upsert: async (payload) => {
      upserts.push(payload);
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal((upserts[0] as { status: string }).status, 'failed');
  assert.equal((upserts[0] as { advice: unknown }).advice, null);
  assert.deepEqual(
    (upserts[0] as { deterministicPlan: unknown }).deterministicPlan,
    deterministicPlan,
  );
  assert.match((upserts[0] as { errorMessage: string }).errorMessage, /timeout/);
});

test('selects persisted generated advice before deterministic review plan', () => {
  const plan = selectSessionResultReviewPlan({
    persistedAdvice: llmAdvice,
    deterministicPlan,
    knowledgeGroups: sampleContext().knowledgeGroups.map((group) => ({
      kpId: 'kp-a',
      knowledgePointName: group.knowledgePointName,
      status: 'needs_work',
      correctCount: group.correctCount,
      totalCount: group.totalCount,
      materials: [
        {
          id: 'm-1',
          materialType: 'common_mistake',
          label: '易错提醒',
          title: '方向别看反',
          content: '注意推出方向。',
          studentSummary: '注意推出方向。',
        },
      ],
    })),
  });

  assert.equal(plan?.headline, llmAdvice.headline);
  assert.equal(plan?.source, 'persisted');
  assert.equal(plan?.focusItems[0]?.suggestion, llmAdvice.focusItems[0]?.suggestedAction);
  assert.deepEqual(plan?.focusItems[0]?.recommendedLabels, ['易错提醒', '解题方法']);
});

test('falls back to deterministic review plan when persisted advice is unavailable', () => {
  const plan = selectSessionResultReviewPlan({
    persistedAdvice: null,
    deterministicPlan,
    knowledgeGroups: [],
  });

  assert.equal(plan?.headline, deterministicPlan.headline);
  assert.equal(plan?.source, 'deterministic');
  assert.doesNotMatch(
    JSON.stringify(plan),
    /generated|failed|provider|qualityFlags|common_mistake/,
  );
});

test('reads no persisted advice when the Prisma review delegate is unavailable', async () => {
  const advice = await readPersistedSessionReviewAdvice('session-1', null);

  assert.equal(advice, null);
});

test('reads no persisted advice when the review advice table is not migrated yet', async () => {
  const advice = await readPersistedSessionReviewAdvice('session-1', {
    findUnique: async () => {
      throw Object.assign(new Error('The table `public.session_review_advice` does not exist'), {
        code: 'P2021',
      });
    },
  });

  assert.equal(advice, null);
});

test('reads only generated persisted advice from the review delegate', async () => {
  const generatedAdvice = await readPersistedSessionReviewAdvice('session-1', {
    findUnique: async (args) => {
      assert.deepEqual(args.where, { session_id: 'session-1' });
      return { status: 'generated', advice: llmAdvice };
    },
  });
  const failedAdvice = await readPersistedSessionReviewAdvice('session-1', {
    findUnique: async () => ({ status: 'failed', advice: llmAdvice }),
  });

  assert.deepEqual(generatedAdvice, llmAdvice);
  assert.equal(failedAdvice, null);
});

function sampleContext() {
  return {
    sessionId: 'session-1',
    studentId: 'student-1',
    subjectId: 'subject-math',
    student: {
      grade: 'senior2',
      stage: 'senior_high',
      targetExam: '高考',
    },
    session: {
      correctCount: 2,
      totalCount: 6,
      isMistakeReview: false,
      completedAt: new Date('2026-06-22T01:00:00Z'),
    },
    attempts: [
      {
        questionSummary: '充分条件与必要条件判断题',
        solutionSummary: '从集合包含关系判断。',
        studentAnswer: 'A',
        correctAnswer: 'B',
        isCorrect: false,
        knowledgePointNames: ['充分条件与必要条件'],
      },
    ],
    knowledgeGroups: [
      {
        knowledgePointName: '充分条件与必要条件',
        status: 'needs_work',
        correctCount: 1,
        totalCount: 2,
        materials: [
          {
            materialType: 'common_mistake',
            label: '易错提醒',
            title: '方向别看反',
            summary: '注意推出方向。',
          },
        ],
      },
    ],
    mastery: [
      {
        knowledgePointName: '充分条件与必要条件',
        masteryScore: 0.42,
        peakMasteryScore: 0.62,
        lastAttemptedAt: new Date('2026-06-22T01:00:00Z'),
        openMistakeCount: 1,
        totalErrorCount: 3,
      },
    ],
    deterministicPlan,
  };
}
