/**
 * openai-chat adapter 单测 —— 不经 callLLM、不经 fetch，直接断言 buildRequest 输出形状。
 *
 * 覆盖 5 类 quirks 组合（探针 2026-06-05 实测的 4 个独立差异）：
 *   1. 默认 quirks → body 含 temperature / max_tokens / response_format
 *   2. supports_temperature=false → body 不含 temperature（Claude 4.7）
 *   3. supports_response_format=false + schema → 不发 response_format，prompt 末尾含 JSON
 *      shape，schemaInPrompt=true（Claude 4.7 / Webex proxy 注入 temperature 规避）
 *   4. max_tokens_param_name=max_completion_tokens → body 用新键（GPT-5 系）
 *   5. output_normalizers=['zh_punct_to_ascii'] 经 postProcess 把 1．1 → 1.1（GPT-5.4）
 *
 * 这些测试与 DB 解耦，CI 跑得快；端到端实活验证留给 admin 探针。
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openaiChatAdapter } from './openai-chat';

const BASE = {
  endpoint: 'https://example.com/openai/v1/chat/completions',
  model: 'test-model',
  token: 'tok',
  prompt: 'hi',
  defaultParams: { temperature: 0.2, max_tokens: 8192 },
};

function bodyOf(init: RequestInit) {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe('openai-chat buildRequest — quirks', () => {
  it('默认 quirks：含 temperature / max_tokens / response_format', () => {
    const r = openaiChatAdapter.buildRequest({
      ...BASE,
      schema: z.object({ ok: z.boolean() }),
      quirks: {},
      outputNormalizers: [],
    });
    const b = bodyOf(r.init);
    expect(b.temperature).toBe(0.2);
    expect(b.max_tokens).toBe(8192);
    expect(b.response_format).toBeDefined();
    expect(r.schemaInPrompt).toBe(false);
  });

  it('supports_temperature=false：body 不含 temperature（Claude 4.7）', () => {
    const r = openaiChatAdapter.buildRequest({
      ...BASE,
      quirks: { supports_temperature: false },
      outputNormalizers: [],
    });
    const b = bodyOf(r.init);
    expect(b.temperature).toBeUndefined();
    expect(b.max_tokens).toBe(8192);
  });

  it('supports_response_format=false + schema：不发 response_format，prompt 末尾含 JSON shape', () => {
    const r = openaiChatAdapter.buildRequest({
      ...BASE,
      schema: z.object({ ok: z.boolean(), msg: z.string() }),
      quirks: { supports_response_format: false, supports_temperature: false },
      outputNormalizers: [],
    });
    const b = bodyOf(r.init);
    expect(b.response_format).toBeUndefined();
    expect(r.schemaInPrompt).toBe(true);
    const messages = b.messages as Array<{ content: string }>;
    const first = messages[0]!;
    expect(first.content).toContain('hi');
    expect(first.content).toContain('JSON Schema');
    // 注入的 schema JSON 真有 ok / msg 字段
    expect(first.content).toContain('"ok"');
    expect(first.content).toContain('"msg"');
  });

  it('max_tokens_param_name=max_completion_tokens：用新键（GPT-5 系）', () => {
    const r = openaiChatAdapter.buildRequest({
      ...BASE,
      defaultParams: { temperature: 0.2, max_tokens: 16384 },
      quirks: { max_tokens_param_name: 'max_completion_tokens' },
      outputNormalizers: [],
    });
    const b = bodyOf(r.init);
    expect(b.max_completion_tokens).toBe(16384);
    expect(b.max_tokens).toBeUndefined();
  });

  it('max_output_tokens 优先级高于 default_params.max_tokens', () => {
    const r = openaiChatAdapter.buildRequest({
      ...BASE,
      defaultParams: { temperature: 0.2, max_tokens: 8192 },
      maxOutputTokens: 2000,
      quirks: {},
      outputNormalizers: [],
    });
    const b = bodyOf(r.init);
    expect(b.max_tokens).toBe(2000);
  });
});

describe('openai-chat postProcess — output_normalizers', () => {
  it('zh_punct_to_ascii：全角点号 / 逗号 → 半角', () => {
    const out = openaiChatAdapter.postProcess!('1．1 引言，关于…', ['zh_punct_to_ascii']);
    expect(out).toBe('1.1 引言,关于…');
  });

  it('prefix_chapter_with_section_sign：行首章节号补 §', () => {
    const out = openaiChatAdapter.postProcess!(
      '1.1 集合\n  2.3.4 子集\n非章节行不动',
      ['prefix_chapter_with_section_sign'],
    );
    expect(out).toContain('§1.1 集合');
    expect(out).toContain('§2.3.4 子集');
    expect(out).toContain('非章节行不动');
  });

  it('顺序敏感：先半角化再前缀（GPT-5.4 实战组合）', () => {
    const out = openaiChatAdapter.postProcess!('1．1 函数', [
      'zh_punct_to_ascii',
      'prefix_chapter_with_section_sign',
    ]);
    expect(out).toBe('§1.1 函数');
  });

  it('normalize_chapter_subsection：§1-1 / §1_1 → §1.1', () => {
    const out = openaiChatAdapter.postProcess!('§1-1 / §2_3', ['normalize_chapter_subsection']);
    expect(out).toBe('§1.1 / §2.3');
  });

  it('未知 normalizer key 静默跳过（向前兼容）', () => {
    const out = openaiChatAdapter.postProcess!('hello', ['some_future_key']);
    expect(out).toBe('hello');
  });

  it('空 normalizers：identity', () => {
    const out = openaiChatAdapter.postProcess!('1．1 hi', []);
    expect(out).toBe('1．1 hi');
  });
});
