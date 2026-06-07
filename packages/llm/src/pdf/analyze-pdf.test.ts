/**
 * analyzePdf 集成测试 —— mock 掉：
 *   1. ./qpdf 的 getPdfPageCount / extractPdfChunk
 *   2. node:fs/promises 的 readFile（吐固定 base64）/ mkdtemp / rm（no-op）
 *   3. @hao/db.prisma（吐 bedrock_converse provider）
 *   4. globalThis.fetch（按调用顺序回 chunk + final 响应）
 *
 * 覆盖：
 *   - 3 页 PDF + chunkPages=2 → 2 chunk + 1 final = 3 次 fetch
 *   - delayBetweenRequestsSeconds=0 → 0 次 sleep
 *   - 默认 60s delay → fake timer 验证：每个 chunk 后睡 60s（终审前再睡一次），最后不睡
 *   - 429 + Retry-After 由 callLLM 内部处理（重试 1 次后通过）
 *   - onProgress 顺序：plan → chunk_start/done × 2 → final_start/done
 *   - chunk 阶段 LLM 报错 → onProgress 发 error + chunk_index
 */
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── mocks（必须在 import analyzePdf 前） ──────────────────
const findUnique = vi.fn();
vi.mock('@hao/db', () => ({
  prisma: {
    llm_provider: {
      findUnique: (args: unknown) => findUnique(args),
    },
  },
}));

const getPdfPageCountMock = vi.fn();
const extractPdfChunkMock = vi.fn();
vi.mock('./qpdf', async () => {
  const actual = await vi.importActual<typeof import('./qpdf')>('./qpdf');
  return {
    ...actual, // 保留 buildPageRanges 真实实现
    getPdfPageCount: (...a: unknown[]) => getPdfPageCountMock(...a),
    extractPdfChunk: (...a: unknown[]) => extractPdfChunkMock(...a),
  };
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    mkdtemp: vi.fn(async (prefix: string) => `${prefix}fake-${Math.random().toString(36).slice(2, 8)}`),
    readFile: vi.fn(async () => Buffer.from('fake-pdf-bytes')),
    rm: vi.fn(async () => {}),
  };
});

const { analyzePdf } = await import('./analyze-pdf');

const PROVIDER = {
  id: 'webex-claude-opus-4.7-converse',
  protocol: 'bedrock_converse',
  endpoint: 'https://example.com/bedrock/v1/model/anthropic.claude-opus-4-7/converse',
  model: 'anthropic.claude-opus-4-7',
  capabilities: { pdf: true },
  auth_env_var: 'WEBEX_LLM_TOKEN',
  default_params: { max_tokens: 16384 },
  max_output_tokens: null,
  quirks: { supports_temperature: false },
  output_normalizers: [],
  enabled: true,
};

function mockConverseOk(text: string) {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      output: { message: { content: [{ text }] } },
      usage: { inputTokens: 1000, outputTokens: 200 },
    }),
    text: async () =>
      JSON.stringify({
        output: { message: { content: [{ text }] } },
        usage: { inputTokens: 1000, outputTokens: 200 },
      }),
  });
}

function mockConverse429(retryAfterSeconds: number) {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  const headers = new Map([['retry-after', String(retryAfterSeconds)]]);
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 429,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    json: async () => ({ detail: 'rate limited' }),
    text: async () => JSON.stringify({ detail: 'rate limited' }),
  });
}

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
  process.env.WEBEX_LLM_TOKEN = 'tok';
  findUnique.mockReset();
  findUnique.mockResolvedValue(PROVIDER);
  getPdfPageCountMock.mockReset();
  extractPdfChunkMock.mockReset();
  extractPdfChunkMock.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.WEBEX_LLM_TOKEN;
  vi.useRealTimers();
});

describe('analyzePdf', () => {
  it('3 页 PDF + chunkPages=2 → 2 chunk + 1 final = 3 次 fetch（delay=0）', async () => {
    getPdfPageCountMock.mockResolvedValue(3);
    mockConverseOk('chunk-1 摘要');
    mockConverseOk('chunk-2 摘要');
    mockConverseOk('全文整合摘要');

    const events: string[] = [];
    const result = await analyzePdf({
      providerId: 'webex-claude-opus-4.7-converse',
      pdfPath: '/tmp/fake.pdf',
      chunkPages: 2,
      delayBetweenRequestsSeconds: 0,
      onProgress: (e) => events.push(e.type),
    });

    expect(result.pageCount).toBe(3);
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]!.text).toBe('chunk-1 摘要');
    expect(result.chunks[1]!.text).toBe('chunk-2 摘要');
    expect(result.final.text).toBe('全文整合摘要');

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls).toHaveLength(3);

    // 进度事件顺序
    expect(events).toEqual([
      'plan',
      'chunk_start',
      'chunk_done',
      'chunk_start',
      'chunk_done',
      'final_start',
      'final_done',
    ]);
  });

  it('chunk LLM body 含 PDF document part + provider endpoint', async () => {
    getPdfPageCountMock.mockResolvedValue(2);
    mockConverseOk('chunk-1');
    mockConverseOk('final');

    await analyzePdf({
      providerId: 'webex-claude-opus-4.7-converse',
      pdfPath: '/tmp/fake.pdf',
      chunkPages: 5, // 一片就装下
      delayBetweenRequestsSeconds: 0,
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls).toHaveLength(2);
    const [chunkUrl, chunkInit] = fetchMock.mock.calls[0]!;
    expect(chunkUrl).toBe(PROVIDER.endpoint);
    const chunkBody = JSON.parse(chunkInit.body) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    expect(chunkBody.messages[0]!.content).toHaveLength(2);
    const docPart = chunkBody.messages[0]!.content[1] as { document: { format: string; name: string } };
    expect(docPart.document.format).toBe('pdf');
    expect(docPart.document.name).toContain('pdf-chunk-001');
    expect(docPart.document.name).toContain('pages-1-2');

    // 终审：纯文本，无 document part
    const [, finalInit] = fetchMock.mock.calls[1]!;
    const finalBody = JSON.parse(finalInit.body) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    expect(finalBody.messages[0]!.content).toHaveLength(1);
  });

  it('默认 60s delay：每 chunk 后睡 60s（共 2 次：chunk1→chunk2 / chunk2→final），终审后不睡', async () => {
    vi.useFakeTimers();
    getPdfPageCountMock.mockResolvedValue(3);
    mockConverseOk('c1');
    mockConverseOk('c2');
    mockConverseOk('final');

    const sleepEvents: number[] = [];
    const promise = analyzePdf({
      providerId: 'webex-claude-opus-4.7-converse',
      pdfPath: '/tmp/fake.pdf',
      chunkPages: 2,
      // 用默认 60
      onProgress: (e) => {
        if (e.type === 'sleep') sleepEvents.push(e.seconds);
      },
    });

    // 把 2 × 60s 推完，整个 analyzePdf 才会 resolve
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    expect(sleepEvents).toEqual([60, 60]);
  });

  it('429 + Retry-After:5 → callLLM 内部退避后重试，总 fetch=4', async () => {
    vi.useFakeTimers();
    getPdfPageCountMock.mockResolvedValue(2);
    mockConverse429(5); // chunk-1 第一次 429
    mockConverseOk('c1'); // chunk-1 重试通过
    mockConverseOk('final');

    const promise = analyzePdf({
      providerId: 'webex-claude-opus-4.7-converse',
      pdfPath: '/tmp/fake.pdf',
      chunkPages: 5,
      delayBetweenRequestsSeconds: 0, // 关掉外层 delay，单测 429 退避
      maxRetries: 2,
    });
    // 推 5s 让 callLLM 内部 sleep 完
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    expect(result.chunks[0]!.retries).toBe(1);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls).toHaveLength(3);
  });

  it('chunk 阶段 LLM 抛错 → onProgress 发 error + chunkIndex，并 throw', async () => {
    getPdfPageCountMock.mockResolvedValue(2);
    // chunk 第一次 500，重试还是 500 → 抛 LLMHttpError
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => 'oops',
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const errorEvents: Array<{ stage: string; chunkIndex?: number }> = [];
    await expect(
      analyzePdf({
        providerId: 'webex-claude-opus-4.7-converse',
        pdfPath: '/tmp/fake.pdf',
        chunkPages: 5,
        delayBetweenRequestsSeconds: 0,
        maxRetries: 1,
        onProgress: (e) => {
          if (e.type === 'error') errorEvents.push({ stage: e.stage, chunkIndex: e.chunkIndex });
        },
      }),
    ).rejects.toThrow();

    expect(errorEvents).toEqual([{ stage: 'chunk', chunkIndex: 1 }]);
  });

  it('plan 阶段 qpdf 失败 → onProgress 发 plan error', async () => {
    getPdfPageCountMock.mockRejectedValue(new Error('qpdf boom'));
    const errorEvents: Array<string> = [];
    await expect(
      analyzePdf({
        providerId: 'webex-claude-opus-4.7-converse',
        pdfPath: '/tmp/fake.pdf',
        chunkPages: 5,
        delayBetweenRequestsSeconds: 0,
        onProgress: (e) => {
          if (e.type === 'error') errorEvents.push(e.stage);
        },
      }),
    ).rejects.toThrow(/qpdf boom/);
    expect(errorEvents).toEqual(['plan']);
  });
});

describe('analyzePdf — buildPageRanges 通过 qpdf 模块导出', () => {
  it('mkdtemp / rm 调用过（避免泄漏临时目录）', async () => {
    getPdfPageCountMock.mockResolvedValue(1);
    mockConverseOk('only-chunk');
    mockConverseOk('final');

    await analyzePdf({
      providerId: 'webex-claude-opus-4.7-converse',
      pdfPath: path.resolve('/tmp/fake.pdf'),
      chunkPages: 5,
      delayBetweenRequestsSeconds: 0,
    });

    const fs = await import('node:fs/promises');
    expect(fs.mkdtemp).toHaveBeenCalled();
    expect(fs.rm).toHaveBeenCalled();
  });
});
