import { describe, expect, it } from 'vitest';

import {
  FIGURE_CROP_PROCESSOR,
  FIGURE_CROP_VERSION,
  buildQuestionFigureAssetKey,
  buildQuestionFigureCropRecord,
  createQuestionFigureCropAssets,
} from './figure-crop';
import type { ListResult, ObjectStore, PutOptions, PutResult } from './types';

const SOURCE_SHA = 'a'.repeat(64);
const QUESTION_ID = '5bf3a5f9-7729-462c-80f7-2fb3714c195d';

describe('question figure crop assets', () => {
  it('builds stable derived_asset identity and metadata from question id and figure id', () => {
    const record = buildQuestionFigureCropRecord({
      sourceSha256: SOURCE_SHA,
      publishedQuestionId: QUESTION_ID,
      figure: {
        id: 'p11-fig-1',
        source_page: 11,
        bbox: { x: 10, y: 20, width: 30, height: 25 },
        description: '函数图像',
      },
    });

    expect(buildQuestionFigureAssetKey(QUESTION_ID, 'p11-fig-1')).toBe(
      `question-${QUESTION_ID}-p11-fig-1.png`,
    );
    expect(record).toEqual({
      source_sha256: SOURCE_SHA,
      processor: FIGURE_CROP_PROCESSOR,
      version: FIGURE_CROP_VERSION,
      asset_key: `question-${QUESTION_ID}-p11-fig-1.png`,
      storage_path: `derived/${SOURCE_SHA}/figure-crop-v1/question-${QUESTION_ID}-p11-fig-1.png`,
      size_bytes: null,
      metadata: {
        processor: FIGURE_CROP_PROCESSOR,
        version: FIGURE_CROP_VERSION,
        question_id: QUESTION_ID,
        figure_id: 'p11-fig-1',
        source_page: 11,
        src_page: 11,
        bbox: { x: 10, y: 20, width: 30, height: 25 },
        bbox_unit: 'page_percent',
        alt: '函数图像',
        description: '函数图像',
      },
    });
  });

  it('renders each source page once, crops valid figures, and stores PNG assets', async () => {
    const store = new MemoryStore();
    const renderedPages: number[] = [];
    const cropInputs: Array<{ page: number; bbox: unknown }> = [];

    const assets = await createQuestionFigureCropAssets({
      store,
      sourceSha256: SOURCE_SHA,
      sourcePdf: Buffer.from('%PDF-1.4'),
      publishedQuestionId: QUESTION_ID,
      figures: [
        {
          id: 'p11-fig-1',
          source_page: 11,
          bbox: { x: 10, y: 20, width: 30, height: 25 },
          description: '函数图像',
        },
        { id: 'no-bbox', source_page: 11, description: '缺 bbox' },
        {
          id: 'p12-fig-1',
          source_page: 12,
          bbox: { x: 0, y: 0, width: 20, height: 10 },
        },
      ],
      renderPage: async ({ pageNumber }) => {
        renderedPages.push(pageNumber);
        return { pageNumber, png: Buffer.from(`page-${pageNumber}`) };
      },
      cropPage: async ({ page, bbox }) => {
        cropInputs.push({ page: page.pageNumber, bbox });
        return Buffer.from(`crop-${page.pageNumber}`);
      },
    });

    expect(renderedPages).toEqual([11, 12]);
    expect(cropInputs).toEqual([
      { page: 11, bbox: { x: 10, y: 20, width: 30, height: 25 } },
      { page: 12, bbox: { x: 0, y: 0, width: 20, height: 10 } },
    ]);
    expect(assets).toHaveLength(2);
    expect(assets[0]).toMatchObject({
      asset_key: `question-${QUESTION_ID}-p11-fig-1.png`,
      size_bytes: Buffer.byteLength('crop-11'),
    });
    expect(
      store.objects.get(
        `derived/${SOURCE_SHA}/figure-crop-v1/question-${QUESTION_ID}-p11-fig-1.png`,
      ),
    ).toEqual(Buffer.from('crop-11'));
  });
});

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Buffer>();

  async put(key: string, body: Buffer, _opts?: PutOptions): Promise<PutResult> {
    this.objects.set(key, body);
    return { key, size: body.length, sha256: 'b'.repeat(64) };
  }

  async get(key: string): Promise<Buffer> {
    const body = this.objects.get(key);
    if (!body) throw new Error(`missing ${key}`);
    return body;
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(_prefix: string): Promise<ListResult> {
    return { keys: Array.from(this.objects.keys()) };
  }

  async presignedGetUrl(key: string): Promise<string> {
    return `/storage/${key}`;
  }
}
