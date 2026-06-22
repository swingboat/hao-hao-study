export type UploadFilePreviewKind = 'pdf' | 'image' | 'open';

export interface UploadFilePreview {
  kind: UploadFilePreviewKind;
  contentType: string;
  label: string;
}

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const IMAGE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export function resolveUploadFilePreview(input: {
  originalName?: string | null;
  fileType?: string | null;
}): UploadFilePreview {
  const extension = extensionOf(input.originalName);
  const contentType = CONTENT_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream';

  if (contentType === 'application/pdf') {
    return { kind: 'pdf', contentType, label: 'PDF 预览' };
  }

  if (IMAGE_CONTENT_TYPES.has(contentType)) {
    return { kind: 'image', contentType, label: '图片预览' };
  }

  return { kind: 'open', contentType, label: '原始文件' };
}

export function buildInlineContentDisposition(originalName?: string | null): string {
  const safeName = asciiFallbackName(originalName);
  const encodedName = encodeURIComponent(originalName?.trim() || safeName);
  return `inline; filename="${safeName}"; filename*=UTF-8''${encodedName}`;
}

export function resolvePdfPreviewPages(input: {
  pageCount?: unknown;
  sourcePages?: unknown[];
}): number[] {
  const pageCount = positiveInteger(input.pageCount);
  const referencedPages = (input.sourcePages ?? []).flatMap((value) => {
    const page = positiveInteger(value);
    return page == null ? [] : [page];
  });
  const maxReferencedPage = Math.max(0, ...referencedPages);
  const totalPages = pageCount ?? (maxReferencedPage > 0 ? maxReferencedPage : null);
  if (!totalPages) return [];
  return Array.from({ length: totalPages }, (_, index) => index + 1);
}

function extensionOf(name?: string | null): string {
  const trimmed = name?.trim();
  if (!trimmed) return '';
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot < 0 || lastDot === trimmed.length - 1) return '';
  return trimmed.slice(lastDot + 1).toLowerCase();
}

function asciiFallbackName(name?: string | null): string {
  const extension = extensionOf(name);
  return extension ? `file.${extension}` : 'file';
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}
