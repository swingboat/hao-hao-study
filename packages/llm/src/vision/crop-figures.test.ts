/**
 * cropFiguresToStorage smoke test：用真 sharp + FileSystemStore 跑一遍裁切链路
 *
 * 覆盖：
 *   - 合法 bbox → 裁出 PNG 落 storage、derivedAssets 含正确元数据
 *   - bbox 越界 / NaN → 进 invalid，不污染 derivedAssets
 *   - 不含图的 item / resource 透传，figures = undefined
 *   - asset_key 去掉中文/标点（item_no 含特殊字符也安全）
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemStore } from '@hao/storage';
import { cropFiguresToStorage } from './crop-figures';
import type { ExtractedItem, ExtractedResource } from './analyze-images';

const SHA = 'b'.repeat(64);

async function makeTestImage(width: number, height: number): Promise<Buffer> {
  // sharp.create 出一张纯色 PNG，足够 metadata 工作
  return await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 200, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

describe('cropFiguresToStorage', () => {
  let root: string;
  let store: FileSystemStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'hao-crop-test-'));
    store = new FileSystemStore({ root, publicBaseUrl: 'http://localhost:3001' });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('裁出合法 bbox 落 storage 并产出 derivedAssets', async () => {
    const png = await makeTestImage(800, 600);
    const items: ExtractedItem[] = [
      {
        content: '题1',
        item_type: 'choice',
        options: [{ label: 'A', text: '1' }],
        answer: 'A',
        solution_text: '',
        difficulty: 3,
        kp_hints: ['kp1'],
        item_no: '例 1',
        figures: [{ figure_no: 1, alt: '示意图', bbox: [0.1, 0.2, 0.5, 0.8] }],
        _src_image: 'page-001',
        _src_page: 1,
      },
    ];

    const r = await cropFiguresToStorage({
      items,
      resources: [],
      imagesByName: { 'page-001': png },
      sourceSha256: SHA,
      store,
    });

    expect(r.invalid).toEqual([]);
    expect(r.derivedAssets).toHaveLength(1);
    const a = r.derivedAssets[0]!;
    expect(a.source_sha256).toBe(SHA);
    expect(a.processor).toBe('figure-crop');
    expect(a.version).toBe('v1');
    expect(a.asset_key).toBe('item-1-_1-fig-1.png');
    expect(a.storage_path).toBe(`derived/${SHA}/figure-crop-v1/item-1-_1-fig-1.png`);
    expect(a.size_bytes).toBeGreaterThan(0);
    expect(a.metadata).toMatchObject({
      processor: 'figure-crop',
      src_image: 'page-001',
      src_page: 1,
      bbox: [0.1, 0.2, 0.5, 0.8],
      alt: '示意图',
    });

    const itemOut = r.items[0]!;
    expect(itemOut.figures).toHaveLength(1);
    const f = itemOut.figures![0]!;
    expect(f.storage_key).toBe(a.storage_path);
    expect(f.url).toBe(`http://localhost:3001/storage/${a.storage_path}`);

    // storage 里真的有这个文件
    expect(await store.exists(a.storage_path)).toBe(true);
  });

  it('bbox 越界 → 进 invalid，不落 storage', async () => {
    const png = await makeTestImage(400, 300);
    const items: ExtractedItem[] = [
      {
        content: '题',
        item_type: 'fill_in',
        options: [],
        answer: '',
        solution_text: '',
        difficulty: 3,
        kp_hints: [],
        figures: [
          { figure_no: 1, bbox: [0, 0, 1.5, 1.5] }, // 越界
          { figure_no: 2, bbox: [0.5, 0.5, 0.3, 0.7] }, // x2<x1
          { figure_no: 3, bbox: [Number.NaN, 0, 1, 1] },
        ],
        _src_image: 'p',
      },
    ];
    const r = await cropFiguresToStorage({
      items,
      resources: [],
      imagesByName: { p: png },
      sourceSha256: SHA,
      store,
    });
    expect(r.invalid).toHaveLength(3);
    expect(r.derivedAssets).toHaveLength(0);
    expect(r.items[0]!.figures).toEqual([]);
  });

  it('没有 figures 的 item / resource 透传，不调用 storage', async () => {
    const png = await makeTestImage(100, 100);
    const items: ExtractedItem[] = [
      {
        content: '题',
        item_type: 'choice',
        options: [],
        answer: '',
        solution_text: '',
        difficulty: 3,
        kp_hints: [],
        _src_image: 'p',
      },
    ];
    const resources: ExtractedResource[] = [
      {
        kp_hint: 'kp',
        resource_kind: 'summary',
        title: 't',
        content: 'c',
        _src_image: 'p',
      },
    ];
    const r = await cropFiguresToStorage({
      items,
      resources,
      imagesByName: { p: png },
      sourceSha256: SHA,
      store,
    });
    expect(r.derivedAssets).toEqual([]);
    expect(r.items[0]!.figures).toBeUndefined();
    expect(r.resources[0]!.figures).toBeUndefined();
  });

  it('缺图片 buffer → 进 invalid，不爆', async () => {
    const items: ExtractedItem[] = [
      {
        content: 'x',
        item_type: 'choice',
        options: [],
        answer: '',
        solution_text: '',
        difficulty: 3,
        kp_hints: [],
        figures: [{ figure_no: 1, bbox: [0, 0, 0.5, 0.5] }],
        _src_image: 'no-such-image',
      },
    ];
    const r = await cropFiguresToStorage({
      items,
      resources: [],
      imagesByName: {},
      sourceSha256: SHA,
      store,
    });
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0]!.reason).toMatch(/no image buffer/);
  });
});
