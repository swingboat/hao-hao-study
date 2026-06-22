export interface KpSelectionHrefInput {
  textbook?: string;
  subject?: string;
  view?: 'list' | 'tree';
  kpId: string;
}

export function buildKpSelectionHref(input: KpSelectionHrefInput): string {
  const qp = new URLSearchParams();
  if (input.textbook) qp.set('textbook', input.textbook);
  if (input.subject) qp.set('subject', input.subject);
  if (input.view === 'list') qp.set('view', 'list');
  qp.set('kp', input.kpId);
  return `/admin/kps?${qp.toString()}#kp-materials`;
}
