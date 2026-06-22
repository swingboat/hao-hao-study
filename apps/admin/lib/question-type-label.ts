export type AdminQuestionType = 'choice' | 'fill_in';

export function questionTypeLabel(type: unknown): string {
  if (type === 'choice') return '选择题';
  if (type === 'fill_in') return '填空题';
  if (typeof type === 'string' && type.trim()) return type.trim();
  return '未识别题型';
}
