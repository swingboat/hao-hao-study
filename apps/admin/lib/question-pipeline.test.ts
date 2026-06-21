import assert from 'node:assert/strict';
import test from 'node:test';
import { QUESTION_PROMPT_VERSION, buildQuestionAnalyzeRequest } from './question-pipeline.ts';

test('buildQuestionAnalyzeRequest forwards runtime controls to analyzeLearningResource', () => {
  const cache = {
    type: 'storage' as const,
    namespace: 'test',
    async getJson() {
      return null;
    },
    async setJson() {},
  };
  const onProgress = () => {};

  const request = buildQuestionAnalyzeRequest(
    {
      providerId: 'openai-chat-gemini-3.1-pro',
      file: {
        type: 'pdf',
        name: 'questions.pdf',
        data: Buffer.from('%PDF').toString('base64'),
      },
      subject: {
        id: 'math_senior',
        name: '高中数学',
        stage: 'senior',
      },
      knowledge: [{ id: 'kp-1', name: '集合' }],
      concurrency: 1,
      maxRetries: 2,
      cache,
    },
    onProgress,
  );

  assert.equal(request.providerId, 'openai-chat-gemini-3.1-pro');
  assert.equal(request.subjectName, '高中数学');
  assert.equal(request.concurrency, 1);
  assert.equal(request.maxRetries, 2);
  assert.equal(request.cache, cache);
  assert.equal(request.onProgress, onProgress);
  assert.equal(QUESTION_PROMPT_VERSION, 'learning_resource/common/analyzeLearningResource');
});
