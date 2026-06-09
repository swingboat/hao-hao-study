/**
 * 测试 openai-chat 适配器在带 image attachment 时的请求体形态
 *
 * 关注：
 *   - 单图：messages[0].content 必须是数组 [{type:'text'}, {type:'image_url'}]
 *   - 多图：每张图一个 image_url part
 *   - data: URL 含正确的 mime（png/jpeg/webp）和 base64
 *   - 无 attachments 时仍是 string content（向前兼容）
 *   - PDF attachment 在 openai_chat 上仍抛错
 */
import { describe, expect, it } from 'vitest';
import { openaiChatAdapter } from './openai-chat';
import type { Attachment } from './types';

const baseArgs = {
  endpoint: 'https://example.com/v1/chat/completions',
  model: 'gemini-3.1-pro',
  token: 'sk-x',
  prompt: '看图',
  defaultParams: { temperature: 0.2, max_tokens: 1000 },
};

describe('openai-chat adapter with image attachments', () => {
  it('单图 → messages[0].content 升级为 [text, image_url]', () => {
    const att: Attachment = { kind: 'image', format: 'png', name: 'p-001', base64: 'AAAB' };
    const { init } = openaiChatAdapter.buildRequest({ ...baseArgs, attachments: [att] });
    const body = JSON.parse(init.body as string);
    expect(Array.isArray(body.messages[0].content)).toBe(true);
    expect(body.messages[0].content).toHaveLength(2);
    expect(body.messages[0].content[0]).toEqual({ type: 'text', text: '看图' });
    expect(body.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAAB' },
    });
  });

  it('多图 → 多个 image_url part，顺序保留', () => {
    const atts: Attachment[] = [
      { kind: 'image', format: 'jpeg', name: 'a', base64: 'A' },
      { kind: 'image', format: 'webp', name: 'b', base64: 'B' },
    ];
    const { init } = openaiChatAdapter.buildRequest({ ...baseArgs, attachments: atts });
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content).toHaveLength(3);
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/jpeg;base64,A');
    expect(body.messages[0].content[2].image_url.url).toBe('data:image/webp;base64,B');
  });

  it('无 attachments → messages[0].content 仍是 string（向前兼容）', () => {
    const { init } = openaiChatAdapter.buildRequest(baseArgs);
    const body = JSON.parse(init.body as string);
    expect(typeof body.messages[0].content).toBe('string');
    expect(body.messages[0].content).toBe('看图');
  });

  it('PDF attachment 在 openai_chat 上仍抛错', () => {
    const att: Attachment = { kind: 'pdf', format: 'pdf', name: 'x', base64: 'A' };
    expect(() => openaiChatAdapter.buildRequest({ ...baseArgs, attachments: [att] })).toThrow(
      /pdf.*bedrock_converse/i,
    );
  });
});
