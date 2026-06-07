/**
 * F4.3 — PDF 文本抽取（pdf-parse v2 API）。
 *
 * ⚠️ v0.1 状态：actions.ts 默认走 analyzePdf（bedrock_converse 原生 PDF）路径；
 * 本模块仅在 provider.protocol !== 'bedrock_converse' 时作为兜底/对照基线使用
 * （例如临时切回 webex-claude-opus-4.7 / Gemini 纯文本路径做 A/B）。
 * F5.x 全量切原生 PDF 后整个文件可删除。
 *
 * 历史背景：上一版 packages/llm 的 OpenAI 适配器仅支持纯文本 messages，admin
 * 侧必须先把 PDF 抽成字符串再送 callLLM；现在 bedrock_converse 适配器已支持
 * attachments={kind:'pdf'} 直接吃 base64 PDF。
 *
 * pdf-parse v2 暴露 PDFParse 类（取代 v1 的默认函数导出）；
 * Node runtime（依赖 Buffer / fs），server action 是 Node OK；
 * 切勿在 middleware（Edge runtime）里调。
 */
import { PDFParse } from 'pdf-parse';

export interface ExtractedPdf {
  text: string;
  numPages: number;
  truncated: boolean;
}

/** 最长保留多少字符送 LLM。
 *
 * Webex Gemini 3.1 Pro context 1M token，单字符 ≈ 0.5 token，
 * 留 prompt + response 余量后，400k 字符（约 200k tokens）足够整本必修教材 270 页。
 * 历史值 80_000 是为防超 context 设的过度保守上限，曾把整本必修一截到只剩前 3 章。
 */
const MAX_CHARS = 400_000;

export async function extractPdfText(buf: Buffer): Promise<ExtractedPdf> {
  const parser = new PDFParse({ data: buf });
  try {
    const textResult = await parser.getText();
    const raw = textResult.text ?? '';
    const numPages = textResult.total ?? textResult.pages?.length ?? 0;
    const truncated = raw.length > MAX_CHARS;
    const text = truncated ? raw.slice(0, MAX_CHARS) : raw;
    return { text, numPages, truncated };
  } finally {
    await parser.destroy();
  }
}
