/**
 * 视觉抽题：每张图独立调一次 LLM，抽出 items + resources（含 figure bbox）。
 *
 * 适用场景：
 *   - PDF → pdftoppm 渲染成每页 PNG → 本模块
 *   - 用户直接上传 image
 *   - 拍照件 / 扫描件 / .pptx 渲染图
 *
 * Provider 选择：v0.1 默认 webex-gemini-3.1-pro（多模态 + 1M context + 单价低）。
 * 也可换 Claude / GPT 多模态，只要 protocol=openai_chat 且 quirks 不挡 image。
 *
 * Prompt 约束（callee 必须遵守 buildPrompt 返回结构）：
 *   - 输出严格 JSON: { items: [...], resources: [...] }
 *   - items 含图必填 figures: [{figure_no, alt, bbox:[x1,y1,x2,y2]}]
 *     bbox 归一化 [0..1]，左上原点
 *   - 题干用 [图1]/[图2] 占位
 */
import { callLLM, extractJsonBlock } from '../callLLM';

export interface AnalyzeImagesInputImage {
  /** 图片字节（PNG/JPEG/WEBP；format 字段决定） */
  png: Buffer;
  /** image format（影响 data: URL mime） */
  format?: 'png' | 'jpeg' | 'webp';
  /** 标识，便于调试/审计；建议 "page-001" */
  name: string;
  /** 可选源页码；落到 item/resource 的 _src_page */
  page?: number;
}

export interface AnalyzeImagesPromptCtx {
  name: string;
  page?: number;
  /** 1-based */
  index: number;
  total: number;
}

export interface AnalyzeImagesOptions {
  providerId: string;
  images: AnalyzeImagesInputImage[];
  promptBuilder: (ctx: AnalyzeImagesPromptCtx) => string;
  /** 两次调用之间睡秒数；默认 0（caller 自己控） */
  delayBetweenRequestsSeconds?: number;
  /** 单次调用 max_tokens（覆盖 provider.max_output_tokens） */
  maxOutputTokens?: number;
  /** 单次调用 429 重试次数；默认 2 */
  maxRetries?: number;
  /** 进度回调 */
  onProgress?: (e: AnalyzeImagesProgressEvent) => void;
}

export type AnalyzeImagesProgressEvent =
  | { type: 'image_start'; index: number; name: string }
  | {
      type: 'image_done';
      index: number;
      name: string;
      latencyMs: number;
      tokenUsage: { input: number; output: number } | null;
      retries: number;
      parseOk: boolean;
      itemCount: number;
      resourceCount: number;
      figureCount: number;
    }
  | { type: 'image_error'; index: number; name: string; error: unknown }
  | { type: 'sleep'; seconds: number };

export interface Figure {
  figure_no: number;
  alt?: string;
  /** 归一化 [x1,y1,x2,y2]，左上原点，0 ≤ x1 < x2 ≤ 1, 0 ≤ y1 < y2 ≤ 1 */
  bbox: [number, number, number, number];
}

export interface ExtractedItem {
  content: string;
  item_type: 'choice' | 'fill_in';
  options: Array<{ label: string; text: string }>;
  answer: string;
  solution_text: string;
  difficulty: number;
  kp_hints: string[];
  item_no?: string;
  figures?: Figure[];
  /** 来源图片 name */
  _src_image: string;
  /** 来源页（caller 传入了就有） */
  _src_page?: number;
}

export interface ExtractedResource {
  kp_hint: string;
  resource_kind: 'summary' | 'method' | 'pitfall' | 'key_point';
  title: string;
  content: string;
  figures?: Figure[];
  _src_image: string;
  _src_page?: number;
}

export interface AnalyzedImage {
  name: string;
  page?: number;
  rawText: string;
  tokenUsage: { input: number; output: number } | null;
  latencyMs: number;
  retries: number;
  parseOk: boolean;
  parseError?: string;
}

export interface AnalyzeImagesResult {
  items: ExtractedItem[];
  resources: ExtractedResource[];
  perImage: AnalyzedImage[];
}

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function analyzeImages(opts: AnalyzeImagesOptions): Promise<AnalyzeImagesResult> {
  const items: ExtractedItem[] = [];
  const resources: ExtractedResource[] = [];
  const perImage: AnalyzedImage[] = [];
  const delayMs = (opts.delayBetweenRequestsSeconds ?? 0) * 1000;

  for (let i = 0; i < opts.images.length; i++) {
    const img = opts.images[i]!;
    opts.onProgress?.({ type: 'image_start', index: i + 1, name: img.name });

    const prompt = opts.promptBuilder({
      name: img.name,
      page: img.page,
      index: i + 1,
      total: opts.images.length,
    });

    try {
      const t0 = Date.now();
      const result = await callLLM({
        providerId: opts.providerId,
        prompt,
        attachments: [
          {
            kind: 'image',
            format: img.format ?? 'png',
            name: img.name,
            base64: img.png.toString('base64'),
          },
        ],
        maxOutputTokens: opts.maxOutputTokens,
        maxRetries: opts.maxRetries ?? 2,
      });

      const parsed = tryParseExtraction(result.rawText);
      if ('items' in parsed) {
        for (const it of parsed.items) {
          items.push({ ...it, _src_image: img.name, _src_page: img.page });
        }
        for (const r of parsed.resources) {
          resources.push({ ...r, _src_image: img.name, _src_page: img.page });
        }
      }

      const figs = 'items' in parsed
        ? parsed.items.reduce((s, it) => s + (it.figures?.length ?? 0), 0)
        : 0;

      perImage.push({
        name: img.name,
        page: img.page,
        rawText: result.rawText,
        tokenUsage: result.tokenUsage,
        latencyMs: Date.now() - t0,
        retries: result.retries,
        parseOk: 'items' in parsed,
        parseError: 'items' in parsed ? undefined : parsed._error,
      });

      opts.onProgress?.({
        type: 'image_done',
        index: i + 1,
        name: img.name,
        latencyMs: Date.now() - t0,
        tokenUsage: result.tokenUsage,
        retries: result.retries,
        parseOk: 'items' in parsed,
        itemCount: 'items' in parsed ? parsed.items.length : 0,
        resourceCount: 'items' in parsed ? parsed.resources.length : 0,
        figureCount: figs,
      });
    } catch (err) {
      perImage.push({
        name: img.name,
        page: img.page,
        rawText: '',
        tokenUsage: null,
        latencyMs: 0,
        retries: 0,
        parseOk: false,
        parseError: String(err).slice(0, 500),
      });
      opts.onProgress?.({ type: 'image_error', index: i + 1, name: img.name, error: err });
    }

    if (i < opts.images.length - 1 && delayMs > 0) {
      opts.onProgress?.({ type: 'sleep', seconds: delayMs / 1000 });
      await SLEEP(delayMs);
    }
  }

  return { items, resources, perImage };
}

interface ParsedExtraction {
  items: Array<Omit<ExtractedItem, '_src_image' | '_src_page'>>;
  resources: Array<Omit<ExtractedResource, '_src_image' | '_src_page'>>;
}

function tryParseExtraction(text: string): ParsedExtraction | { _error: string } {
  let obj: unknown;
  try {
    obj = extractJsonBlock(text);
  } catch (e) {
    return { _error: `JSON parse failed: ${String(e).slice(0, 200)}` };
  }
  const o = obj as Partial<ParsedExtraction> | null;
  if (!o || !Array.isArray(o.items) || !Array.isArray(o.resources)) {
    return { _error: 'shape mismatch: expect { items:[], resources:[] }' };
  }
  return o as ParsedExtraction;
}
