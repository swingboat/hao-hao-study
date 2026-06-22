export interface QuestionOptionLike {
  label?: string;
  text?: string;
}

const OPTION_LINE_RE = /^\s*([A-Za-z])[\.\u3001\uff0e、\)]\s*(.+?)\s*$/;

export function stripDuplicatedChoiceOptionsFromContent(
  content: string,
  options: QuestionOptionLike[],
): string {
  const normalizedOptions = options
    .map((option) => ({
      label: (option.label ?? '').trim().toUpperCase(),
      text: normalizeOptionText(option.text ?? ''),
    }))
    .filter((option) => option.label && option.text);

  if (normalizedOptions.length < 2) return content.trim();

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  while (lines.length > 0 && !lines[lines.length - 1]?.trim()) lines.pop();

  const parsedSuffix: Array<{ label: string; text: string }> = [];
  let suffixStart = lines.length;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined || !line.trim()) break;
    const parsed = parseOptionLine(line);
    if (!parsed) break;
    parsedSuffix.unshift(parsed);
    suffixStart = index;
  }

  if (parsedSuffix.length < 2) return content.trim();
  if (!optionSuffixMatches(parsedSuffix, normalizedOptions)) return content.trim();

  return lines.slice(0, suffixStart).join('\n').trim();
}

function parseOptionLine(line: string): { label: string; text: string } | null {
  const match = line.match(OPTION_LINE_RE);
  if (!match?.[1] || !match[2]) return null;
  return {
    label: match[1].toUpperCase(),
    text: normalizeOptionText(match[2]),
  };
}

function optionSuffixMatches(
  suffix: Array<{ label: string; text: string }>,
  options: Array<{ label: string; text: string }>,
): boolean {
  if (suffix.length !== options.length) return false;
  return suffix.every((item, index) => {
    const option = options[index];
    return option?.label === item.label && option.text === item.text;
  });
}

function normalizeOptionText(value: string): string {
  return value
    .trim()
    .replace(/^\$+|\$+$/g, '')
    .replace(/\s+/g, '');
}
