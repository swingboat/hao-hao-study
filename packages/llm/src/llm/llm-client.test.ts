import { describe, expect, it } from 'vitest';

import { callLlm } from '../index.ts';

const targetConfig = {
  base_url: 'https://proxy.example.test',
  default_headers: {
    Authorization: 'Bearer ${LLM_PROXY_API_KEY}',
    'Content-Type': 'application/json',
  },
};

describe('callLlm', () => {
  it('returns response headers for parser retry decisions', async () => {
    const target = {
      id: 'google-generate-content-gemini-3-pro-image-preview',
      provider: 'google',
      api_shape: 'google-generate-content',
      model: 'google.gemini-3-pro-image-preview',
      method: 'POST',
      path: '/google/v1/models/google.gemini-3-pro-image-preview:generateContent',
    };

    const result = await callLlm({
      targetConfig,
      target,
      input: '请解析图片。',
      apiKey: 'test-token',
      now: () => 1000,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            detail: 'Rate limit exceeded. retry after 2 seconds.',
          }),
          {
            status: 429,
            headers: {
              'retry-after': '2',
              'content-type': 'application/json',
            },
          },
        ),
    });

    expect(result.ok).toBe(false);
    expect(result.http_status).toBe(429);
    expect(result.headers).toEqual({
      'content-type': 'application/json',
      'retry-after': '2',
    });
    expect(result.raw).toEqual({
      detail: 'Rate limit exceeded. retry after 2 seconds.',
    });
  });
});
