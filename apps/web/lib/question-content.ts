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
  const raw = stripObjectPlaceholderLines(String(value ?? ''));
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

export function stripEmbeddedChoiceOptions(
  value: unknown,
  options: readonly { label: string; text: string }[],
): string {
  const raw = String(value ?? '');
  if (options.length < 2) return raw;

  const lines = raw.split(/\r?\n/);
  while (lines.length > 0 && !lines[lines.length - 1]?.trim()) {
    lines.pop();
  }

  const optionStartIndex = findTrailingOptionBlockStart(lines, options);
  if (optionStartIndex === -1) return raw;

  return lines.slice(0, optionStartIndex).join('\n').trimEnd();
}

function pushTextPart(parts: QuestionContentPart[], value: string): void {
  const text = formatStudentDisplayText(value);
  if (text) parts.push({ type: 'text', text });
}

function findTrailingOptionBlockStart(
  lines: readonly string[],
  options: readonly { label: string; text: string }[],
): number {
  const labels = options.map((option) => normalizeOptionLabel(option.label)).filter(Boolean);
  if (labels.length < 2) return -1;

  for (
    let start = Math.max(0, lines.length - labels.length - 1);
    start < lines.length;
    start += 1
  ) {
    if (readLeadingChoiceLabel(lines[start] ?? '') !== labels[0]) continue;

    let expectedIndex = 0;

    for (let lineIndex = start; lineIndex < lines.length; lineIndex += 1) {
      const label = readLeadingChoiceLabel(lines[lineIndex] ?? '');
      if (!label) continue;
      if (label !== labels[expectedIndex]) {
        expectedIndex = -1;
        break;
      }
      expectedIndex += 1;
    }

    if (expectedIndex === labels.length) return start;
  }

  return -1;
}

function readLeadingChoiceLabel(line: string): string | null {
  const match = line.match(/^\s*([A-ZＡ-Ｚ])\s*[.．、]/i);
  return match?.[1] ? normalizeOptionLabel(match[1]) : null;
}

function normalizeOptionLabel(label: string): string {
  return label.trim().normalize('NFKC').toUpperCase();
}

function stripObjectPlaceholderLines(value: string): string {
  return value
    .split(/\r?\n/)
    .filter((line) => !isObjectPlaceholderLine(line))
    .join('\n')
    .trimEnd();
}

function isObjectPlaceholderLine(line: string): boolean {
  return /^\s*(?:\d+[.．、]\s*)?\[object Object\]\s*$/i.test(line);
}
