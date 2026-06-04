/**
 * callLLM 集成测试
 *
 * 用 vi.mock 把 @hao/db.prisma 与全局 fetch 替成桩，覆盖：
 *   - openai_chat 协议 happy path（schema 校验通过）
 *   - google_generate_content 协议 happy path
 *   - schema 第一次失败 → retry 1 次后通过
 *   - HTTP 5xx 第一次失败 → retry 1 次后通过
 *   - HTTP 4xx 立即抛（不 retry）
 *   - provider 不存在 / disabled / env 缺失各抛
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// ─── 准备 prisma mock（必须在 import callLLM 前） ──────────
const findUnique = vi.fn();
vi.mock('@hao/db', () => ({
  prisma: {
    llm_provider: {
      findUnique: (args: unknown) => findUnique(args),
    },
  },
}));

// 动态 import：让 vi.mock 先生效
const { callLLM, LLMHttpError, LLMSchemaError } = await import('./callLLM');

// ─── fetch mock 帮手 ──────────────────────────────────────
function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

const Schema = z.object({ items: z.array(z.object({ name: z.string() })) });

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
  process.env.WEBEX_LLM_TOKEN = 'test-token-xyz';
  findUnique.mockReset();
});

afterEach(() => {
  delete process.env.WEBEX_LLM_TOKEN;
});

const OPENAI_PROVIDER = {
  id: 'webex-gemini-3.1-pro',
  protocol: 'openai_chat',
  endpoint: 'https://example.com/openai/v1/chat/completions',
  model: 'google.gemini-3.1-pro-global',
  capabilities: {},
  auth_env_var: 'WEBEX_LLM_TOKEN',
  default_params: { temperature: 0.2, max_tokens: 8192 },
  enabled: true,
};

const GOOGLE_PROVIDER = {
  id: 'webex-gemini-3-pro-image',
  protocol: 'google_generate_content',
  endpoint: 'https://example.com/google/v1/models/foo:generateContent',
  model: 'google.gemini-3-pro-image-preview',
  capabilities: {},
  auth_env_var: 'WEBEX_LLM_TOKEN',
  default_params: { temperature: 0.7, max_tokens: 1024 },
  enabled: true,
};

describe('callLLM — openai_chat happy path', () => {
  it('schema 通过返回 parsed.data，并暴露 requestPayload', async () => {
    findUnique.mockResolvedValue(OPENAI_PROVIDER);
    mockFetchOnce(200, {
      choices: [{ message: { content: '{"items":[{"name":"函数的单调性"}]}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 30 },
    });

    const result = await callLLM({
      providerId: 'webex-gemini-3.1-pro',
      prompt: '抽 KP',
      schema: Schema,
    });

    expect(result.data).toEqual({ items: [{ name: '函数的单调性' }] });
    expect(result.tokenUsage).toEqual({ input: 100, output: 30 });
    expect(result.retries).toBe(0);
    expect(result.provider).toBe('webex-gemini-3.1-pro');
    // requestPayload 含 model + response_format（structured output）
    const body = result.requestPayload as { model: string; response_format?: object };
    expect(body.model).toBe('google.gemini-3.1-pro-global');
    expect(body.response_format).toBeDefined();
  });

  it('未传 schema 时 data = rawText 字符串', async () => {
    findUnique.mockResolvedValue(OPENAI_PROVIDER);
    mockFetchOnce(200, {
      choices: [{ message: { content: 'just plain text' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    });

    const result = await callLLM({ providerId: 'webex-gemini-3.1-pro', prompt: 'hi' });
    expect(result.data).toBe('just plain text');
    expect(result.rawText).toBe('just plain text');
  });
});

describe('callLLM — google_generate_content happy path', () => {
  it('Google 协议解析 candidates[].content.parts[].text + usageMetadata', async () => {
    findUnique.mockResolvedValue(GOOGLE_PROVIDER);
    mockFetchOnce(200, {
      candidates: [{ content: { parts: [{ text: '{"items":[{"name":"导数"}]}' }] } }],
      usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 },
    });

    const result = await callLLM({
      providerId: 'webex-gemini-3-pro-image',
      prompt: '抽 KP',
      schema: Schema,
    });

    expect(result.data).toEqual({ items: [{ name: '导数' }] });
    expect(result.tokenUsage).toEqual({ input: 80, output: 20 });
    // generationConfig.responseSchema 是 structured-output 标志
    const body = result.requestPayload as { generationConfig?: { responseSchema?: object } };
    expect(body.generationConfig?.responseSchema).toBeDefined();
  });
});

describe('callLLM — retry 行为', () => {
  it('schema 第一次失败 → retry 1 次后通过，retries=1', async () => {
    findUnique.mockResolvedValue(OPENAI_PROVIDER);
    mockFetchOnce(200, { choices: [{ message: { content: 'not json at all' } }] });
    mockFetchOnce(200, {
      choices: [{ message: { content: '{"items":[{"name":"second try"}]}' } }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    });

    const result = await callLLM({
      providerId: 'webex-gemini-3.1-pro',
      prompt: '抽 KP',
      schema: Schema,
    });
    expect(result.retries).toBe(1);
    expect(result.data).toEqual({ items: [{ name: 'second try' }] });
  });

  it('HTTP 503 → retry 1 次后通过', async () => {
    findUnique.mockResolvedValue(OPENAI_PROVIDER);
    mockFetchOnce(503, 'upstream blew up');
    mockFetchOnce(200, {
      choices: [{ message: { content: '{"items":[{"name":"recovered"}]}' } }],
    });

    const result = await callLLM({
      providerId: 'webex-gemini-3.1-pro',
      prompt: '抽 KP',
      schema: Schema,
    });
    expect(result.retries).toBe(1);
    expect(result.data).toEqual({ items: [{ name: 'recovered' }] });
  });

  it('HTTP 400 立即抛 LLMHttpError（不 retry）', async () => {
    findUnique.mockResolvedValue(OPENAI_PROVIDER);
    mockFetchOnce(400, 'bad request');
    await expect(
      callLLM({ providerId: 'webex-gemini-3.1-pro', prompt: 'x' }),
    ).rejects.toBeInstanceOf(LLMHttpError);
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('schema 连续失败超过 maxRetries → 抛 LLMSchemaError', async () => {
    findUnique.mockResolvedValue(OPENAI_PROVIDER);
    mockFetchOnce(200, { choices: [{ message: { content: 'garbage' } }] });
    mockFetchOnce(200, { choices: [{ message: { content: 'still garbage' } }] });
    await expect(
      callLLM({ providerId: 'webex-gemini-3.1-pro', prompt: 'x', schema: Schema }),
    ).rejects.toBeInstanceOf(LLMSchemaError);
  });
});

describe('callLLM — 错误前置校验', () => {
  it('provider 不存在 → throw', async () => {
    findUnique.mockResolvedValue(null);
    await expect(callLLM({ providerId: 'nope', prompt: 'x' })).rejects.toThrow(/not found/);
  });

  it('provider disabled → throw', async () => {
    findUnique.mockResolvedValue({ ...OPENAI_PROVIDER, enabled: false });
    await expect(
      callLLM({ providerId: 'webex-gemini-3.1-pro', prompt: 'x' }),
    ).rejects.toThrow(/disabled/);
  });

  it('env var 缺失 → throw', async () => {
    delete process.env.WEBEX_LLM_TOKEN;
    findUnique.mockResolvedValue(OPENAI_PROVIDER);
    await expect(
      callLLM({ providerId: 'webex-gemini-3.1-pro', prompt: 'x' }),
    ).rejects.toThrow(/WEBEX_LLM_TOKEN/);
  });
});

describe('extractJsonBlock', () => {
  it('容忍 ```json ... ``` 包裹', async () => {
    const { extractJsonBlock } = await import('./callLLM');
    expect(extractJsonBlock('前置说明\n```json\n{"a":1}\n```\n尾巴')).toEqual({ a: 1 });
  });
  it('容忍前后混入解释文字', async () => {
    const { extractJsonBlock } = await import('./callLLM');
    expect(extractJsonBlock('好的，结果如下：{"a":2} 完毕')).toEqual({ a: 2 });
  });
  it('纯 JSON 也能解', async () => {
    const { extractJsonBlock } = await import('./callLLM');
    expect(extractJsonBlock('{"a":3}')).toEqual({ a: 3 });
  });
});
