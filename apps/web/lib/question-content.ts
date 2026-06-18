import { formatStudentDisplayText } from './display-text';

const FIGURE_TOKEN_PATTERN = /\[\[figure:([^\]\s]+)\]\]/g;
const MISSING_FIGURE_DESCRIPTION = '题图暂时不可见，请先跳过这题。';

export interface QuestionFigureInput {
  id: string;
  description?: string | null;
  imageUrl?: string | null;
}

export type QuestionContentPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'figure';
      id: string;
      description: string;
      imageUrl?: string;
    };

export function buildQuestionContentParts(
  value: unknown,
  figures: readonly QuestionFigureInput[] = [],
): QuestionContentPart[] {
  const raw = String(value ?? '');
  const figureById = new Map(figures.map((figure) => [figure.id, figure]));
  const parts: QuestionContentPart[] = [];
  let cursor = 0;

  for (const match of raw.matchAll(FIGURE_TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    pushTextPart(parts, raw.slice(cursor, index));

    const figureId = match[1] ?? '';
    const figure = figureById.get(figureId);
    const description = formatStudentDisplayText(figure?.description || MISSING_FIGURE_DESCRIPTION);
    const part: QuestionContentPart = {
      type: 'figure',
      id: figureId,
      description,
    };
    if (figure?.imageUrl) part.imageUrl = figure.imageUrl;
    parts.push(part);

    cursor = index + match[0].length;
  }

  pushTextPart(parts, raw.slice(cursor));
  if (parts.length > 0) return parts;

  const text = formatStudentDisplayText(raw);
  return text ? [{ type: 'text', text }] : [];
}

export function questionContentPartsToPlainText(parts: readonly QuestionContentPart[]): string {
  return parts
    .map((part) => (part.type === 'text' ? part.text : `题图：${part.description}`))
    .filter(Boolean)
    .join('\n');
}

function pushTextPart(parts: QuestionContentPart[], value: string): void {
  const text = formatStudentDisplayText(value);
  if (text) parts.push({ type: 'text', text });
}
