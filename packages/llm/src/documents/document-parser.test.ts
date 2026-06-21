import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseDocumentPages, parsePdfPages } from '../index.ts';

const targetConfig = {
  base_url: 'https://proxy.example.test',
  default_headers: {
    Authorization: 'Bearer ${LLM_PROXY_API_KEY}',
    'Content-Type': 'application/json',
  },
};

const target = {
  id: 'openai-chat-gemini-3-1-pro-global',
  provider: 'openai',
  api_shape: 'openai-chat-completions',
  model: 'google.gemini-3.1-pro-global',
  method: 'POST',
  path: '/openai/v1/chat/completions',
};

const page = { pageNumber: 1, mimeType: 'image/png', data: 'page-image' };

type DocumentResult = {
  payload_log_path?: string;
  pages: Array<{
    text?: string;
    http_status?: number | null;
  }>;
};

describe('parseDocumentPages retry backoff', () => {
  it('waits for Retry-After before retrying a 429 page response', async () => {
    const sleeps: number[] = [];
    const events: Array<Record<string, unknown>> = [];
    let calls = 0;

    const result = (await parseDocumentPages({
      targetConfig,
      target,
      documentType: 'question',
      pages: [page],
      synthesize: false,
      retrySleepImpl: async (delayMs: number) => sleeps.push(delayMs),
      onProgress: (event: Record<string, unknown>) => events.push(event),
      callLlmImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: false,
            llm_target_id: target.id,
            target_id: target.id,
            provider: target.provider,
            model: target.model,
            api_shape: target.api_shape,
            http_status: 429,
            headers: { 'retry-after': '2' },
            latency_ms: 1,
            usage: null,
            text: '',
            raw: { detail: 'rate limited' },
          };
        }

        return {
          ok: true,
          llm_target_id: target.id,
          target_id: target.id,
          provider: target.provider,
          model: target.model,
          api_shape: target.api_shape,
          http_status: 200,
          headers: {},
          latency_ms: 1,
          usage: null,
          text: '重试后成功',
          raw: {},
        };
      },
    })) as DocumentResult;

    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);
    expect(result.pages?.[0]?.text).toBe('重试后成功');
    expect(events.map((event) => event.stage)).toEqual([
      'page_started',
      'page_retry_wait',
      'page_done',
    ]);
    expect(events[1]).toMatchObject({
      page_number: 1,
      http_status: 429,
      retry_after_ms: 2000,
      attempt: 1,
      next_attempt: 2,
    });
  });

  it('parses retry after seconds from 429 response detail', async () => {
    const sleeps: number[] = [];
    let calls = 0;

    await parseDocumentPages({
      targetConfig,
      target,
      documentType: 'question',
      pages: [page],
      synthesize: false,
      retrySleepImpl: async (delayMs: number) => sleeps.push(delayMs),
      callLlmImpl: async () => {
        calls += 1;
        return calls === 1
          ? {
              ok: false,
              llm_target_id: target.id,
              target_id: target.id,
              provider: target.provider,
              model: target.model,
              api_shape: target.api_shape,
              http_status: 429,
              headers: {},
              latency_ms: 1,
              usage: null,
              text: '',
              raw: { detail: 'Rate limit exceeded. retry after 33.70 seconds.' },
            }
          : {
              ok: true,
              llm_target_id: target.id,
              target_id: target.id,
              provider: target.provider,
              model: target.model,
              api_shape: target.api_shape,
              http_status: 200,
              headers: {},
              latency_ms: 1,
              usage: null,
              text: 'ok',
              raw: {},
            };
      },
    });

    expect(calls).toBe(2);
    expect(sleeps).toEqual([34000]);
  });

  it('uses conservative backoff when retryable failures lack retry hints', async () => {
    const sleeps: number[] = [];
    let calls = 0;

    await parseDocumentPages({
      targetConfig,
      target,
      documentType: 'question',
      pages: [page],
      synthesize: false,
      retrySleepImpl: async (delayMs: number) => sleeps.push(delayMs),
      callLlmImpl: async () => {
        calls += 1;
        return calls === 1
          ? {
              ok: false,
              llm_target_id: target.id,
              target_id: target.id,
              provider: target.provider,
              model: target.model,
              api_shape: target.api_shape,
              http_status: 500,
              headers: {},
              latency_ms: 1,
              usage: null,
              text: '',
              raw: { detail: 'temporary failure' },
            }
          : {
              ok: true,
              llm_target_id: target.id,
              target_id: target.id,
              provider: target.provider,
              model: target.model,
              api_shape: target.api_shape,
              http_status: 200,
              headers: {},
              latency_ms: 1,
              usage: null,
              text: 'ok',
              raw: {},
            };
      },
    });

    expect(calls).toBe(2);
    expect(sleeps).toEqual([10_000]);
  });

  it('does not retry non-retryable page failures', async () => {
    const sleeps: number[] = [];
    let calls = 0;

    const result = (await parseDocumentPages({
      targetConfig,
      target,
      documentType: 'question',
      pages: [page],
      synthesize: false,
      retrySleepImpl: async (delayMs: number) => sleeps.push(delayMs),
      callLlmImpl: async () => {
        calls += 1;
        return {
          ok: false,
          llm_target_id: target.id,
          target_id: target.id,
          provider: target.provider,
          model: target.model,
          api_shape: target.api_shape,
          http_status: 400,
          headers: {},
          latency_ms: 1,
          usage: null,
          text: '',
          raw: { detail: 'bad request' },
        };
      },
    })) as DocumentResult;

    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
    expect(result.pages?.[0]?.http_status).toBe(400);
  });

  it('passes through payload log path for downstream diagnostics', async () => {
    const result = (await parseDocumentPages({
      targetConfig,
      target,
      documentType: 'mixed_learning_material',
      pages: [page],
      synthesize: false,
      payloadLogPath: '/tmp/mixed-payload.ndjson',
      callLlmImpl: async () => ({
        ok: true,
        llm_target_id: target.id,
        target_id: target.id,
        provider: target.provider,
        model: target.model,
        api_shape: target.api_shape,
        http_status: 200,
        headers: {},
        latency_ms: 1,
        usage: null,
        text: 'ok',
        raw: {},
      }),
    })) as DocumentResult;

    expect(result.payload_log_path).toBe('/tmp/mixed-payload.ndjson');
  });

  it('accepts PDF file paths for page rendering', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'hao-pdf-path-'));
    try {
      const pdfPath = path.join(tmpDir, 'lesson.pdf');
      await writeFile(pdfPath, 'fake-pdf');

      const result = (await parsePdfPages({
        targetConfig,
        target,
        pdf: {
          name: 'lesson.pdf',
          path: pdfPath,
        },
        synthesize: false,
        renderPdfToPageImagesImpl: async (input: { path: string }) => {
          expect(input.path).toBe(pdfPath);
          return [page];
        },
        callLlmImpl: async () => ({
          ok: true,
          llm_target_id: target.id,
          target_id: target.id,
          provider: target.provider,
          model: target.model,
          api_shape: target.api_shape,
          http_status: 200,
          headers: {},
          latency_ms: 1,
          usage: null,
          text: 'ok',
          raw: {},
        }),
      })) as DocumentResult;

      expect(result.pages?.[0]?.text).toBe('ok');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
