/**
 * bedrock-converse adapter 单测 —— 不经 callLLM、不经 fetch，直接断言 buildRequest /
 * parseResponse 输出形状。
 *
 * 覆盖：
 *   1. text + 1 PDF attachment → body.messages[0].content 形态（text + document）
 *   2. schema 给定 → schemaInPrompt=true，prompt 末尾追加 JSON Schema
 *   3. parseResponse：output.message.content 多 part 文本拼接 + usage.inputTokens/outputTokens
 *   4. quirks supports_temperature=false → inferenceConfig 不出现 temperature（Claude 4.7）
 *   5. attachments=undefined / [] → content 仍只有 text part
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bedrockConverseAdapter } from './bedrock-converse';
import type { Attachment } from './types';

const BASE = {
  endpoint: 'https://example.com/bedrock/v1/model/anthropic.claude-opus-4-7/converse',
  model: 'anthropic.claude-opus-4-7',
  token: 'tok',
  prompt: '请总结这份 PDF',
  defaultParams: { max_tokens: 1800 },
};

const PDF_ATT: Attachment = {
  kind: 'pdf',
  format: 'pdf',
  name: 'pdf-chunk-001-pages-1-15',
  base64: 'JVBERi0xLjQKJ...truncated',
};

function bodyOf(init: RequestInit) {
  return JSON.parse(init.body as string) as {
    messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
    inferenceConfig: Record<string, unknown>;
  };
}

describe('bedrock-converse buildRequest', () => {
  it('text + 1 PDF attachment：content 形态正确', () => {
    const r = bedrockConverseAdapter.buildRequest({
      ...BASE,
      attachments: [PDF_ATT],
      quirks: { supports_temperature: false },
    });
    const b = bodyOf(r.init);
    expect(b.messages).toHaveLength(1);
    const content = b.messages[0]!.content;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ text: '请总结这份 PDF' });
    expect(content[1]).toEqual({
      document: {
        format: 'pdf',
        name: 'pdf-chunk-001-pages-1-15',
        source: { bytes: PDF_ATT.base64 },
      },
    });
    // Authorization 走 header
    const headers = r.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('schema 给定：schemaInPrompt=true，prompt 末尾含 JSON Schema', () => {
    const r = bedrockConverseAdapter.buildRequest({
      ...BASE,
      schema: z.object({ ok: z.boolean(), msg: z.string() }),
      attachments: [PDF_ATT],
      quirks: { supports_temperature: false },
    });
    expect(r.schemaInPrompt).toBe(true);
    const b = bodyOf(r.init);
    const text = b.messages[0]!.content[0] as { text: string };
    expect(text.text).toContain('请总结这份 PDF');
    expect(text.text).toContain('JSON Schema');
    expect(text.text).toContain('"ok"');
    expect(text.text).toContain('"msg"');
  });

  it('inferenceConfig.maxTokens：max_output_tokens > default_params.max_tokens', () => {
    const r = bedrockConverseAdapter.buildRequest({
      ...BASE,
      maxOutputTokens: 3000,
      quirks: { supports_temperature: false },
    });
    const b = bodyOf(r.init);
    expect(b.inferenceConfig.maxTokens).toBe(3000);
  });

  it('quirks supports_temperature=false：inferenceConfig 不含 temperature（Claude 4.7）', () => {
    const r = bedrockConverseAdapter.buildRequest({
      ...BASE,
      defaultParams: { max_tokens: 1800, temperature: 0.5 },
      quirks: { supports_temperature: false },
    });
    const b = bodyOf(r.init);
    expect(b.inferenceConfig.temperature).toBeUndefined();
    expect(b.inferenceConfig.maxTokens).toBe(1800);
  });

  it('默认 quirks（无 supports_temperature 设置）：当 default_params 有 temperature 时带上', () => {
    const r = bedrockConverseAdapter.buildRequest({
      ...BASE,
      defaultParams: { max_tokens: 1800, temperature: 0.5 },
      quirks: {},
    });
    const b = bodyOf(r.init);
    expect(b.inferenceConfig.temperature).toBe(0.5);
  });

  it('attachments=undefined：content 仅 text part', () => {
    const r = bedrockConverseAdapter.buildRequest({
      ...BASE,
      quirks: { supports_temperature: false },
    });
    const b = bodyOf(r.init);
    expect(b.messages[0]!.content).toHaveLength(1);
    expect(b.messages[0]!.content[0]).toEqual({ text: '请总结这份 PDF' });
  });
});

describe('bedrock-converse parseResponse', () => {
  it('output.message.content 多 text part 拼接 + usage.inputTokens/outputTokens', () => {
    const out = bedrockConverseAdapter.parseResponse({
      output: {
        message: {
          content: [{ text: '第一段' }, { text: '第二段' }],
        },
      },
      usage: { inputTokens: 1200, outputTokens: 350 },
    });
    expect(out.rawText).toBe('第一段\n第二段');
    expect(out.tokenUsage).toEqual({ input: 1200, output: 350 });
  });

  it('usage 缺字段 → tokenUsage=null', () => {
    const out = bedrockConverseAdapter.parseResponse({
      output: { message: { content: [{ text: 'x' }] } },
    });
    expect(out.rawText).toBe('x');
    expect(out.tokenUsage).toBeNull();
  });

  it('content 为空 → rawText=""', () => {
    const out = bedrockConverseAdapter.parseResponse({ output: { message: { content: [] } } });
    expect(out.rawText).toBe('');
  });
});

describe('bedrock-converse postProcess', () => {
  it('复用 applyNormalizers：zh_punct_to_ascii 生效', () => {
    const out = bedrockConverseAdapter.postProcess!('1．1 引言', ['zh_punct_to_ascii']);
    expect(out).toBe('1.1 引言');
  });
});
