/**
 * F4.3 — PDF 文本抽取（pdf-parse v2 API）。
 *
 * 当前 packages/llm 的 OpenAI 适配器仅支持 `messages: [{role, content: string}]`
 * 形态（注释明确写"v0.1 仅支持纯文本 prompt"），因此 admin 侧需先把 PDF 抽成
 * 纯文本再送给 callLLM。等总控扩展适配器为多模态后再切到原生 PDF 输入。
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

/** 最长保留多少字符送 LLM（防超 context；Webex Gemini 3.1 Pro 很宽，但保留余量）。 */
const MAX_CHARS = 80_000;

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
