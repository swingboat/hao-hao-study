import { StoragePaths } from './paths';
import type { ObjectStore } from './types';

export const FIGURE_CROP_PROCESSOR = 'figure-crop';
export const FIGURE_CROP_VERSION = 'v1';

export interface FigureBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QuestionFigure {
  id?: unknown;
  source_page?: unknown;
  sourcePage?: unknown;
  page?: unknown;
  page_number?: unknown;
  bbox?: unknown;
  description?: unknown;
  alt?: unknown;
}

export interface RenderedPagePng {
  pageNumber: number;
  png: Buffer;
}

export interface FigureCropMetadata {
  processor: typeof FIGURE_CROP_PROCESSOR;
  version: typeof FIGURE_CROP_VERSION;
  question_id: string;
  figure_id: string;
  source_page: number;
  src_page: number;
  bbox: FigureBbox;
  bbox_unit: 'page_percent';
  alt: string;
  description: string;
}

export interface FigureCropAssetRecord {
  source_sha256: string;
  processor: typeof FIGURE_CROP_PROCESSOR;
  version: typeof FIGURE_CROP_VERSION;
  asset_key: string;
  storage_path: string;
  size_bytes: number | null;
  metadata: FigureCropMetadata;
}

export interface BuildQuestionFigureCropRecordInput {
  sourceSha256: string;
  publishedQuestionId: string;
  figure: QuestionFigure;
}

export interface CreateQuestionFigureCropAssetsInput {
  store: ObjectStore;
  sourceSha256: string;
  sourcePdf: Buffer;
  publishedQuestionId: string;
  figures: QuestionFigure[];
  dpi?: number;
  renderPage?: (input: {
    sourcePdf: Buffer;
    pageNumber: number;
    dpi: number;
  }) => Promise<RenderedPagePng>;
  cropPage?: (input: { page: RenderedPagePng; bbox: FigureBbox }) => Promise<Buffer>;
}

export function buildQuestionFigureAssetKey(publishedQuestionId: string, figureId: string): string {
  return `question-${safeAssetSegment(publishedQuestionId)}-${safeAssetSegment(figureId)}.png`;
}

export function buildQuestionFigureCropRecord(
  input: BuildQuestionFigureCropRecordInput,
): FigureCropAssetRecord {
  const figure = normalizeFigure(input.figure);
  if (!figure) throw new Error('figure must have id, source_page, and bbox');

  const assetKey = buildQuestionFigureAssetKey(input.publishedQuestionId, figure.id);
  return {
    source_sha256: input.sourceSha256,
    processor: FIGURE_CROP_PROCESSOR,
    version: FIGURE_CROP_VERSION,
    asset_key: assetKey,
    storage_path: StoragePaths.derived(
      input.sourceSha256,
      FIGURE_CROP_PROCESSOR,
      FIGURE_CROP_VERSION,
      assetKey,
    ),
    size_bytes: null,
    metadata: {
      processor: FIGURE_CROP_PROCESSOR,
      version: FIGURE_CROP_VERSION,
      question_id: input.publishedQuestionId,
      figure_id: figure.id,
      source_page: figure.sourcePage,
      src_page: figure.sourcePage,
      bbox: figure.bbox,
      bbox_unit: 'page_percent',
      alt: figure.description,
      description: figure.description,
    },
  };
}

function normalizeFigure(
  figure: QuestionFigure,
): { id: string; sourcePage: number; bbox: FigureBbox; description: string } | null {
  const id = stringOrNull(figure.id);
  const sourcePage = positiveIntOrNull(
    figure.source_page ?? figure.sourcePage ?? figure.page_number ?? figure.page,
  );
  const bbox = normalizeBbox(figure.bbox);
  if (!id || sourcePage == null || !bbox) return null;
  const description = stringOrNull(figure.description) ?? stringOrNull(figure.alt) ?? '';
  return { id, sourcePage, bbox, description };
}

function normalizeBbox(value: unknown): FigureBbox | null {
  if (Array.isArray(value) && value.length >= 4) {
    return finiteBbox({
      x: Number(value[0]),
      y: Number(value[1]),
      width: Number(value[2]),
      height: Number(value[3]),
    });
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return finiteBbox({
    x: Number(record.x ?? record.left),
    y: Number(record.y ?? record.top),
    width: Number(record.width ?? record.w),
    height: Number(record.height ?? record.h),
  });
}

function finiteBbox(bbox: FigureBbox): FigureBbox | null {
  if (![bbox.x, bbox.y, bbox.width, bbox.height].every(Number.isFinite)) return null;
  if (bbox.width <= 0 || bbox.height <= 0) return null;
  return {
    x: clampNumber(bbox.x, 0, 100),
    y: clampNumber(bbox.y, 0, 100),
    width: clampNumber(bbox.width, 0, 100),
    height: clampNumber(bbox.height, 0, 100),
  };
}

function safeAssetSegment(value: string): string {
  const safe = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return safe || 'unknown';
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveIntOrNull(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
