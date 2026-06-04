/**
 * @hao/llm — index.ts 还没写完之前先把 callLLM 主体跑通；现在 index.ts 已落，
 * 历史骨架字段（ProviderId / LLM_VERSION 等）由 ./callLLM + ./redact + ./json-schema 重出。
 */
import { describe, expect, it } from 'vitest';
import { redactAuthHeaders } from './redact';

describe('redactAuthHeaders', () => {
  it('替换 headers.Authorization 的 Bearer token', () => {
    const input = {
      method: 'POST',
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.real-token' },
    };
    const out = redactAuthHeaders(input);
    expect(out.headers.Authorization).toBe('***REDACTED***');
  });

  it('大小写不敏感地命中 header key（authorization / X-API-Key / Cookie）', () => {
    const input = {
      headers: {
        authorization: 'Bearer xxx',
        'X-API-Key': 'sk-abc',
        Cookie: 'session=xyz',
      },
    };
    const out = redactAuthHeaders(input);
    expect(out.headers.authorization).toBe('***REDACTED***');
    expect(out.headers['X-API-Key']).toBe('***REDACTED***');
    expect(out.headers.Cookie).toBe('***REDACTED***');
  });

  it('替换 body 中 api_key / access_token 等敏感字段', () => {
    const input = { body: { api_key: 'sk-1', accessToken: 'tk', secret: 's' } };
    const out = redactAuthHeaders(input);
    expect(out.body.api_key).toBe('***REDACTED***');
    expect(out.body.accessToken).toBe('***REDACTED***');
    expect(out.body.secret).toBe('***REDACTED***');
  });

  it('不误杀业务字段 max_tokens / token_usage', () => {
    const input = {
      body: { max_tokens: 8192, token_usage: { input: 100, output: 50 } },
    };
    const out = redactAuthHeaders(input);
    expect(out.body.max_tokens).toBe(8192);
    expect(out.body.token_usage).toEqual({ input: 100, output: 50 });
  });

  it('不修改原对象（深克隆语义）', () => {
    const input = { headers: { Authorization: 'Bearer real' } };
    redactAuthHeaders(input);
    expect(input.headers.Authorization).toBe('Bearer real');
  });

  it('递归处理嵌套对象与数组', () => {
    const input = {
      requests: [
        { headers: { Authorization: 'Bearer a' } },
        { headers: { Authorization: 'Bearer b' } },
      ],
      meta: { nested: { api_key: 'k' } },
    };
    const out = redactAuthHeaders(input);
    expect(out.requests[0]?.headers.Authorization).toBe('***REDACTED***');
    expect(out.requests[1]?.headers.Authorization).toBe('***REDACTED***');
    expect(out.meta.nested.api_key).toBe('***REDACTED***');
  });

  it('兜底：任意字符串字段以 "Bearer " 开头时也替换', () => {
    const input = { custom: 'Bearer leaked-token' };
    const out = redactAuthHeaders(input);
    expect(out.custom).toBe('Bearer ***REDACTED***');
  });

  it('null / undefined / 原始值原样返回', () => {
    expect(redactAuthHeaders(null)).toBeNull();
    expect(redactAuthHeaders(undefined)).toBeUndefined();
    expect(redactAuthHeaders(42)).toBe(42);
    expect(redactAuthHeaders('plain')).toBe('plain');
  });
});
