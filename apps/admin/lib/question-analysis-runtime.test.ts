import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStorageDocumentCache,
  questionParseJobStatus,
  resolveQuestionAnalysisRuntime,
} from './question-analysis-runtime.ts';

class MemoryStore {
  writes = new Map<string, Buffer>();

  async put(key: string, body: Buffer) {
    this.writes.set(key, body);
    return { key, size: body.length, sha256: '0'.repeat(64) };
  }

  async get(key: string) {
    const body = this.writes.get(key);
    if (!body) {
      const error = new Error('missing') as Error & { code?: string };
      error.code = 'STORAGE_NOT_FOUND';
      throw error;
    }
    return body;
  }

  async exists() {
    return false;
  }

  async delete() {}

  async list() {
    return { keys: [] };
  }

  async presignedGetUrl() {
    return '';
  }
}

test('resolveQuestionAnalysisRuntime uses conservative defaults for admin parsing', () => {
  const runtime = resolveQuestionAnalysisRuntime({});

  assert.equal(runtime.concurrency, 1);
  assert.equal(runtime.maxRetries, 2);
});

test('resolveQuestionAnalysisRuntime accepts bounded env overrides', () => {
  const runtime = resolveQuestionAnalysisRuntime({
    ADMIN_QUESTION_PARSE_CONCURRENCY: '3',
    ADMIN_QUESTION_PARSE_MAX_RETRIES: '4',
  });

  assert.equal(runtime.concurrency, 3);
  assert.equal(runtime.maxRetries, 4);
});

test('resolveQuestionAnalysisRuntime falls back on invalid env values', () => {
  const runtime = resolveQuestionAnalysisRuntime({
    ADMIN_QUESTION_PARSE_CONCURRENCY: '0',
    ADMIN_QUESTION_PARSE_MAX_RETRIES: 'abc',
  });

  assert.equal(runtime.concurrency, 1);
  assert.equal(runtime.maxRetries, 2);
});

test('createStorageDocumentCache stores JSON through ObjectStore derived paths', async () => {
  const store = new MemoryStore();
  const cache = createStorageDocumentCache({
    store,
    namespace: 'question-analysis-test',
  });
  const cacheKey = 'a'.repeat(64);

  assert.equal(await cache.getJson(cacheKey), null);
  await cache.setJson(cacheKey, { ok: true, nested: { count: 2 } });

  const storageKey = Array.from(store.writes.keys())[0];
  assert.equal(
    storageKey,
    `derived/${cacheKey}/llm-cache-v1/question-analysis-test.json`,
  );
  assert.deepEqual(await cache.getJson(cacheKey), { ok: true, nested: { count: 2 } });
});

test('questionParseJobStatus only treats fully ok analysis as succeeded', () => {
  assert.equal(questionParseJobStatus('ok'), 'succeeded');
  assert.equal(questionParseJobStatus('partial'), 'failed');
  assert.equal(questionParseJobStatus('failed'), 'failed');
});
