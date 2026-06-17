import assert from 'node:assert/strict';
import test from 'node:test';
import { createAndPersistQuestionFigureCropAssets } from './question-figure-assets.ts';

const SOURCE_SHA = 'a'.repeat(64);

function createDbRecorder() {
  const upserts: unknown[] = [];
  return {
    upserts,
    db: {
      derived_asset: {
        async upsert(args: unknown) {
          upserts.push(args);
        },
      },
    },
  };
}

function createStore(pdf = Buffer.from('%PDF-test')) {
  const gets: string[] = [];
  return {
    gets,
    store: {
      async get(key: string) {
        gets.push(key);
        return pdf;
      },
      async put() {
        return { key: 'derived/key.png', size: 3, sha256: SOURCE_SHA };
      },
      async exists() {
        return false;
      },
      async delete() {},
      async list() {
        return { keys: [] };
      },
      async presignedGetUrl() {
        return '';
      },
    },
  };
}

test('createAndPersistQuestionFigureCropAssets reads source PDF, generates crops, and upserts records', async () => {
  const { db, upserts } = createDbRecorder();
  const { store, gets } = createStore();
  const calls: unknown[] = [];

  const result = await createAndPersistQuestionFigureCropAssets({
    db,
    store,
    staging: {
      id: 'staging-1',
      upload: { file_uri: 'uploads/source.pdf', sha256: SOURCE_SHA },
      llm_payload: {
        figures: [
          {
            id: 'p1-fig-1',
            source_page: 1,
            bbox: { x: 10, y: 20, width: 30, height: 40 },
            description: '函数图像',
          },
          { id: 'missing-bbox', source_page: 1 },
        ],
      },
    },
    publishedQuestionId: 'question-1',
    async createAssets(input) {
      calls.push(input);
      return [
        {
          source_sha256: SOURCE_SHA,
          processor: 'figure-crop',
          version: 'v1',
          asset_key: 'question-question-1-p1-fig-1.png',
          storage_path: 'derived/source/figure-crop-v1/question-question-1-p1-fig-1.png',
          size_bytes: 123,
          metadata: {
            processor: 'figure-crop',
            version: 'v1',
            question_id: 'question-1',
            figure_id: 'p1-fig-1',
            source_page: 1,
            src_page: 1,
            bbox: { x: 10, y: 20, width: 30, height: 40 },
            bbox_unit: 'page_percent',
            alt: '函数图像',
            description: '函数图像',
          },
        },
      ];
    },
  });

  assert.deepEqual(result, { generated: 1, skipped: false, warning: null });
  assert.deepEqual(gets, ['uploads/source.pdf']);
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { figures: unknown[] }).figures.length, 1);
  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0], {
    where: {
      source_sha256_processor_version_asset_key: {
        source_sha256: SOURCE_SHA,
        processor: 'figure-crop',
        version: 'v1',
        asset_key: 'question-question-1-p1-fig-1.png',
      },
    },
    update: {
      storage_path: 'derived/source/figure-crop-v1/question-question-1-p1-fig-1.png',
      size_bytes: 123,
      metadata: {
        processor: 'figure-crop',
        version: 'v1',
        question_id: 'question-1',
        figure_id: 'p1-fig-1',
        source_page: 1,
        src_page: 1,
        bbox: { x: 10, y: 20, width: 30, height: 40 },
        bbox_unit: 'page_percent',
        alt: '函数图像',
        description: '函数图像',
      },
    },
    create: {
      source_sha256: SOURCE_SHA,
      processor: 'figure-crop',
      version: 'v1',
      asset_key: 'question-question-1-p1-fig-1.png',
      storage_path: 'derived/source/figure-crop-v1/question-question-1-p1-fig-1.png',
      size_bytes: 123,
      metadata: {
        processor: 'figure-crop',
        version: 'v1',
        question_id: 'question-1',
        figure_id: 'p1-fig-1',
        source_page: 1,
        src_page: 1,
        bbox: { x: 10, y: 20, width: 30, height: 40 },
        bbox_unit: 'page_percent',
        alt: '函数图像',
        description: '函数图像',
      },
    },
  });
});

test('createAndPersistQuestionFigureCropAssets skips missing sha256 or usable figures without reading storage', async () => {
  const { db, upserts } = createDbRecorder();
  const { store, gets } = createStore();

  const result = await createAndPersistQuestionFigureCropAssets({
    db,
    store,
    staging: {
      id: 'staging-2',
      upload: { file_uri: 'uploads/source.pdf', sha256: null },
      llm_payload: { figures: [{ id: 'p1-fig-1', source_page: 1 }] },
    },
    publishedQuestionId: 'question-2',
    async createAssets() {
      throw new Error('should not create assets');
    },
  });

  assert.deepEqual(result, { generated: 0, skipped: true, warning: null });
  assert.deepEqual(gets, []);
  assert.deepEqual(upserts, []);
});

test('createAndPersistQuestionFigureCropAssets warns but does not throw when crop generation fails', async () => {
  const { db, upserts } = createDbRecorder();
  const { store } = createStore();
  const warnings: string[] = [];

  const result = await createAndPersistQuestionFigureCropAssets({
    db,
    store,
    staging: {
      id: 'staging-3',
      upload: { file_uri: 'uploads/source.pdf', sha256: SOURCE_SHA },
      llm_payload: {
        figures: [{ id: 'p1-fig-1', source_page: 1, bbox: [1, 2, 3, 4] }],
      },
    },
    publishedQuestionId: 'question-3',
    async createAssets() {
      throw new Error('pdftoppm failed');
    },
    warn(message) {
      warnings.push(message);
    },
  });

  assert.deepEqual(result, { generated: 0, skipped: false, warning: 'pdftoppm failed' });
  assert.deepEqual(upserts, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /staging-3/);
  assert.match(warnings[0] ?? '', /question-3/);
});
