import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore } from './factory';
import { FileSystemStore } from './fs-store';
import { StoragePaths, extOf, sha256OfBuffer } from './paths';
import { ChecksumMismatchError, NotFoundError } from './types';

describe('FileSystemStore', () => {
  let root: string;
  let store: FileSystemStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'hao-storage-test-'));
    store = new FileSystemStore({ root, publicBaseUrl: 'http://localhost:3001' });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('put + get round-trip with sha256', async () => {
    const body = Buffer.from('hello world');
    const result = await store.put('uploads/test/hello.txt', body);
    expect(result.size).toBe(body.length);
    expect(result.sha256).toBe(sha256OfBuffer(body));

    const fetched = await store.get('uploads/test/hello.txt');
    expect(fetched.equals(body)).toBe(true);
  });

  it('put creates nested directories', async () => {
    await store.put('a/b/c/d/file.bin', Buffer.from([1, 2, 3]));
    expect(await store.exists('a/b/c/d/file.bin')).toBe(true);
  });

  it('put is idempotent (overwrite same key)', async () => {
    await store.put('x', Buffer.from('v1'));
    await store.put('x', Buffer.from('v2'));
    expect((await store.get('x')).toString()).toBe('v2');
  });

  it('expectedSha256 mismatch throws ChecksumMismatchError and does not write', async () => {
    const body = Buffer.from('payload');
    await expect(store.put('y', body, { expectedSha256: 'a'.repeat(64) })).rejects.toBeInstanceOf(
      ChecksumMismatchError,
    );
    expect(await store.exists('y')).toBe(false);
  });

  it('expectedSha256 match succeeds', async () => {
    const body = Buffer.from('payload');
    const sha = sha256OfBuffer(body);
    const r = await store.put('y', body, { expectedSha256: sha });
    expect(r.sha256).toBe(sha);
  });

  it('get on missing key throws NotFoundError', async () => {
    await expect(store.get('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('exists returns false on missing key, true on existing', async () => {
    expect(await store.exists('nope')).toBe(false);
    await store.put('present', Buffer.from('x'));
    expect(await store.exists('present')).toBe(true);
  });

  it('delete is idempotent (no throw on missing)', async () => {
    await expect(store.delete('not-there')).resolves.toBeUndefined();
    await store.put('there', Buffer.from('x'));
    await store.delete('there');
    expect(await store.exists('there')).toBe(false);
  });

  it('list returns all keys under a directory prefix', async () => {
    await store.put('derived/abc/rasterize-v1/page-001.png', Buffer.from('1'));
    await store.put('derived/abc/rasterize-v1/page-002.png', Buffer.from('2'));
    await store.put('derived/abc/figure-crop-v1/item-1-fig-1.png', Buffer.from('f'));
    await store.put('derived/xyz/rasterize-v1/page-001.png', Buffer.from('3'));

    const r = await store.list('derived/abc/rasterize-v1');
    expect(r.keys).toEqual([
      'derived/abc/rasterize-v1/page-001.png',
      'derived/abc/rasterize-v1/page-002.png',
    ]);
  });

  it('list works with file-prefix (not a directory)', async () => {
    await store.put('derived/abc/rasterize-v1/page-001.png', Buffer.from('1'));
    await store.put('derived/abc/rasterize-v1/page-002.png', Buffer.from('2'));
    await store.put('derived/abc/rasterize-v1/cover.png', Buffer.from('c'));
    const r = await store.list('derived/abc/rasterize-v1/page-');
    expect(r.keys).toEqual([
      'derived/abc/rasterize-v1/page-001.png',
      'derived/abc/rasterize-v1/page-002.png',
    ]);
  });

  it('list on missing prefix returns empty', async () => {
    expect((await store.list('nothing/here')).keys).toEqual([]);
  });

  it('unsafe keys rejected', async () => {
    await expect(store.put('/abs/path', Buffer.from('x'))).rejects.toThrow(/unsafe/);
    await expect(store.put('../escape', Buffer.from('x'))).rejects.toThrow(/unsafe/);
  });

  it('presignedGetUrl returns publicBaseUrl-prefixed path', async () => {
    const url = await store.presignedGetUrl('uploads/sha256/ab/abcdef.pdf');
    expect(url).toBe('http://localhost:3001/storage/uploads/sha256/ab/abcdef.pdf');
  });

  it('presignedGetUrl without publicBaseUrl returns root-relative path', async () => {
    const s2 = new FileSystemStore({ root });
    expect(await s2.presignedGetUrl('a/b.png')).toBe('/storage/a/b.png');
  });

  it('presignedGetUrl encodes special characters', async () => {
    const url = await store.presignedGetUrl('uploads/中文 文件.png');
    expect(url).toContain('%E4%B8%AD%E6%96%87');
    expect(url).toContain('%20');
  });

  it('FileSystemStore rejects relative root', () => {
    expect(() => new FileSystemStore({ root: './relative' })).toThrow(/absolute/);
  });
});

describe('StoragePaths', () => {
  const SHA = 'a'.repeat(64);

  it('upload uses 2-char bucket prefix', () => {
    expect(StoragePaths.upload(SHA, 'pdf')).toBe(`uploads/sha256/aa/${SHA}.pdf`);
  });
  it('upload normalizes extension', () => {
    expect(StoragePaths.upload(SHA, '.PNG')).toBe(`uploads/sha256/aa/${SHA}.png`);
  });
  it('derived composes processor-version', () => {
    expect(StoragePaths.derived(SHA, 'rasterize', 'v1', 'page-001.png')).toBe(
      `derived/${SHA}/rasterize-v1/page-001.png`,
    );
  });
  it('llmJob strips leading slash on sub', () => {
    expect(StoragePaths.llmJob('11111111-2222-3333-4444-555555555555', '/raw/page-01.json')).toBe(
      'llm-jobs/11111111-2222-3333-4444-555555555555/raw/page-01.json',
    );
  });
  it('rejects bad sha256', () => {
    expect(() => StoragePaths.upload('not-hex', 'pdf')).toThrow(/sha256/);
  });
  it('rejects bad processor / version slug', () => {
    expect(() => StoragePaths.derived(SHA, 'pro cess', 'v1', 'x')).toThrow(/processor/);
    expect(() => StoragePaths.derived(SHA, 'rasterize', 'v 1', 'x')).toThrow(/version/);
  });
});

describe('extOf', () => {
  it('extracts extension lowercased', () => {
    expect(extOf('/path/to/FILE.PDF')).toBe('pdf');
    expect(extOf('image.PNG')).toBe('png');
  });
  it('returns bin for no extension', () => {
    expect(extOf('Makefile')).toBe('bin');
  });
});

describe('createStore', () => {
  it('returns FileSystemStore for STORAGE_DRIVER=fs', () => {
    const s = createStore({ STORAGE_DRIVER: 'fs', STORAGE_FS_ROOT: '/tmp/x' });
    expect(s).toBeInstanceOf(FileSystemStore);
  });
  it('defaults to fs', () => {
    const s = createStore({ STORAGE_FS_ROOT: '/tmp/x' });
    expect(s).toBeInstanceOf(FileSystemStore);
  });
  it('throws when fs is selected but root missing', () => {
    expect(() => createStore({ STORAGE_DRIVER: 'fs' })).toThrow(/STORAGE_FS_ROOT/);
  });
  it('throws on s3 in v0.1', () => {
    expect(() => createStore({ STORAGE_DRIVER: 's3' })).toThrow(/not implemented/);
  });
  it('throws on unknown driver', () => {
    expect(() => createStore({ STORAGE_DRIVER: 'gcs' })).toThrow(/unknown/);
  });
});
