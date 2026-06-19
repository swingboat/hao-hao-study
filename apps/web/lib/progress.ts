export type ProgressStatus = 'not_started' | 'needs_work' | 'learning' | 'mastered' | 'regressed';
export type ProgressFilter = 'all' | 'needs_work' | 'learning' | 'mastered' | 'not_started';

export interface ProgressTextbookOption {
  id: string;
  title: string;
  edition: string | null;
  publisher: string | null;
  volume: string | null;
}

export interface ProgressKnowledgePointSource {
  id: string;
  name: string;
  chapter_no: string | null;
}

export interface ProgressMasterySource {
  kp_id: string;
  mastery_score: number;
  peak_mastery_score: number;
}

export interface ProgressAttemptSource {
  kp_id: string;
  answered_at: Date;
}

export interface ProgressKpSource {
  kp_id: string;
}

export interface ProgressDueReviewSource {
  kp_id: string;
  next_review_at: Date;
}

export interface BuildLearningProgressInput {
  knowledgePoints: readonly ProgressKnowledgePointSource[];
  masteryRows: readonly ProgressMasterySource[];
  attemptRows: readonly ProgressAttemptSource[];
  openMistakeRows: readonly ProgressKpSource[];
  dueReviewRows: readonly ProgressDueReviewSource[];
}

export interface ProgressSummary {
  unlockedCount: number;
  startedCount: number;
  masteredCount: number;
  needsWorkCount: number;
}

export interface ProgressItem {
  id: string;
  name: string;
  chapterNo: string | null;
  status: ProgressStatus;
  progressPercent: number;
  practiceCount: number;
  lastPracticedAt: Date | null;
  hasOpenMistake: boolean;
  needsReview: boolean;
}

export interface ProgressSectionGroup {
  id: string;
  label: string;
  itemCount: number;
  needsWorkCount: number;
  masteredCount: number;
  defaultOpen: boolean;
  items: ProgressItem[];
}

export interface ProgressChapterGroup {
  id: string;
  label: string;
  itemCount: number;
  needsWorkCount: number;
  masteredCount: number;
  defaultOpen: boolean;
  sections: ProgressSectionGroup[];
}

export interface LearningProgressData {
  summary: ProgressSummary;
  items: ProgressItem[];
  chapters: string[];
}

export function resolveActiveTextbook(
  textbooks: readonly ProgressTextbookOption[],
  selectedIndex: string | undefined,
): { textbook: ProgressTextbookOption; index: number } | null {
  if (textbooks.length === 0) return null;
  const index = Number.parseInt(selectedIndex ?? '0', 10);
  if (Number.isInteger(index) && index >= 0 && index < textbooks.length) {
    const textbook = textbooks[index];
    if (textbook) return { textbook, index };
  }
  const firstTextbook = textbooks[0];
  return firstTextbook ? { textbook: firstTextbook, index: 0 } : null;
}

export function textbookOptionLabel(textbook: ProgressTextbookOption): string {
  return [textbook.title, textbook.volume, textbook.edition, textbook.publisher]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

export function buildLearningProgress(input: BuildLearningProgressInput): LearningProgressData {
  const masteryByKp = new Map(input.masteryRows.map((row) => [row.kp_id, row]));
  const openMistakeKpIds = new Set(input.openMistakeRows.map((row) => row.kp_id));
  const dueReviewKpIds = new Set(input.dueReviewRows.map((row) => row.kp_id));
  const practiceByKp = buildPracticeByKp(input.attemptRows);

  const items = input.knowledgePoints.map((kp) => {
    const mastery = masteryByKp.get(kp.id);
    const practice = practiceByKp.get(kp.id);
    const score = mastery?.mastery_score ?? 0;

    return {
      id: kp.id,
      name: kp.name,
      chapterNo: kp.chapter_no,
      status: resolveProgressStatus(mastery),
      progressPercent: Math.round(clamp01(score) * 100),
      practiceCount: practice?.count ?? 0,
      lastPracticedAt: practice?.lastPracticedAt ?? null,
      hasOpenMistake: openMistakeKpIds.has(kp.id),
      needsReview: dueReviewKpIds.has(kp.id),
    };
  });

  const summary = items.reduce<ProgressSummary>(
    (current, item) => ({
      unlockedCount: current.unlockedCount + 1,
      startedCount:
        item.status !== 'not_started' || item.practiceCount > 0
          ? current.startedCount + 1
          : current.startedCount,
      masteredCount: item.status === 'mastered' ? current.masteredCount + 1 : current.masteredCount,
      needsWorkCount:
        isNeedsWorkItem(item) || item.hasOpenMistake
          ? current.needsWorkCount + 1
          : current.needsWorkCount,
    }),
    { unlockedCount: 0, startedCount: 0, masteredCount: 0, needsWorkCount: 0 },
  );

  return {
    summary,
    items,
    chapters: uniqueSortedChapters(input.knowledgePoints),
  };
}

export function filterProgressItems(
  items: readonly ProgressItem[],
  filter: ProgressFilter,
  chapterNo?: string,
): ProgressItem[] {
  return items.filter((item) => {
    const matchesFilter =
      filter === 'all' ||
      (filter === 'needs_work' && (isNeedsWorkItem(item) || item.hasOpenMistake)) ||
      item.status === filter;
    const matchesChapter = !chapterNo || item.chapterNo === chapterNo;
    return matchesFilter && matchesChapter;
  });
}

export function sortProgressItems(items: readonly ProgressItem[]): ProgressItem[] {
  return [...items].sort((a, b) => {
    const priority = progressPriority(a) - progressPriority(b);
    if (priority !== 0) return priority;
    const chapterOrder = compareChapterNo(a.chapterNo, b.chapterNo);
    if (chapterOrder !== 0) return chapterOrder;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

export function groupProgressItemsByChapter(
  items: readonly ProgressItem[],
): ProgressChapterGroup[] {
  const chapters = new Map<string, MutableChapterGroup>();

  for (const item of [...items].sort(compareProgressItemsByChapter)) {
    const chapter = chapterGroupFor(item.chapterNo);
    const section = sectionGroupFor(item.chapterNo);
    const chapterGroup =
      chapters.get(chapter.id) ??
      createMutableChapterGroup({
        id: chapter.id,
        label: chapter.label,
        sortValue: chapter.sortValue,
      });
    const sectionGroup =
      chapterGroup.sections.get(section.id) ??
      createMutableSectionGroup({
        id: section.id,
        label: section.label,
        sortValue: section.sortValue,
      });

    sectionGroup.items.push(item);
    updateGroupCounts(sectionGroup, item);
    chapterGroup.sections.set(section.id, sectionGroup);
    updateGroupCounts(chapterGroup, item);
    chapters.set(chapter.id, chapterGroup);
  }

  return [...chapters.values()]
    .sort((a, b) => compareSortValue(a.sortValue, b.sortValue) || a.label.localeCompare(b.label))
    .map((chapter) => ({
      id: chapter.id,
      label: chapter.label,
      itemCount: chapter.itemCount,
      needsWorkCount: chapter.needsWorkCount,
      masteredCount: chapter.masteredCount,
      defaultOpen: chapter.defaultOpen,
      sections: [...chapter.sections.values()]
        .sort(
          (a, b) => compareSortValue(a.sortValue, b.sortValue) || a.label.localeCompare(b.label),
        )
        .map((section) => ({
          id: section.id,
          label: section.label,
          itemCount: section.itemCount,
          needsWorkCount: section.needsWorkCount,
          masteredCount: section.masteredCount,
          defaultOpen: section.defaultOpen,
          items: section.items,
        })),
    }));
}

export function progressStatusLabel(status: ProgressStatus): string {
  switch (status) {
    case 'not_started':
      return '未开始';
    case 'needs_work':
      return '需要加强';
    case 'learning':
      return '学习中';
    case 'mastered':
      return '已掌握';
    case 'regressed':
      return '曾掌握后回落';
  }
}

export function progressFilterLabel(filter: ProgressFilter): string {
  switch (filter) {
    case 'all':
      return '全部';
    case 'needs_work':
      return '需要加强';
    case 'learning':
      return '学习中';
    case 'mastered':
      return '已掌握';
    case 'not_started':
      return '未开始';
  }
}

function resolveProgressStatus(mastery: ProgressMasterySource | undefined): ProgressStatus {
  if (!mastery) return 'not_started';
  if (mastery.mastery_score < 0.2 && mastery.peak_mastery_score >= 0.5) return 'regressed';
  if (mastery.mastery_score < 0.5) return 'needs_work';
  if (mastery.mastery_score < 0.85) return 'learning';
  return 'mastered';
}

function isNeedsWorkItem(item: ProgressItem): boolean {
  return item.status === 'needs_work' || item.status === 'regressed';
}

interface MutableGroupCounts {
  itemCount: number;
  needsWorkCount: number;
  masteredCount: number;
  defaultOpen: boolean;
}

interface MutableSectionGroup extends MutableGroupCounts {
  id: string;
  label: string;
  sortValue: string | null;
  items: ProgressItem[];
}

interface MutableChapterGroup extends MutableGroupCounts {
  id: string;
  label: string;
  sortValue: string | null;
  sections: Map<string, MutableSectionGroup>;
}

function createMutableChapterGroup({
  id,
  label,
  sortValue,
}: {
  id: string;
  label: string;
  sortValue: string | null;
}): MutableChapterGroup {
  return {
    id,
    label,
    sortValue,
    itemCount: 0,
    needsWorkCount: 0,
    masteredCount: 0,
    defaultOpen: false,
    sections: new Map(),
  };
}

function createMutableSectionGroup({
  id,
  label,
  sortValue,
}: {
  id: string;
  label: string;
  sortValue: string | null;
}): MutableSectionGroup {
  return {
    id,
    label,
    sortValue,
    itemCount: 0,
    needsWorkCount: 0,
    masteredCount: 0,
    defaultOpen: false,
    items: [],
  };
}

function updateGroupCounts(group: MutableGroupCounts, item: ProgressItem) {
  group.itemCount += 1;
  if (isNeedsWorkItem(item) || item.hasOpenMistake) {
    group.needsWorkCount += 1;
    group.defaultOpen = true;
  }
  if (item.needsReview) group.defaultOpen = true;
  if (item.status === 'mastered') group.masteredCount += 1;
}

function chapterGroupFor(chapterNo: string | null): {
  id: string;
  label: string;
  sortValue: string | null;
} {
  if (!chapterNo) return { id: 'chapter-unassigned', label: '未分章', sortValue: null };

  const numericChapter = chapterNo.match(/^(\d+)(?:\.|$)/)?.[1];
  if (numericChapter) {
    const normalized = String(Number.parseInt(numericChapter, 10));
    return {
      id: `chapter-${normalized}`,
      label: `第 ${normalized} 章`,
      sortValue: normalized,
    };
  }

  if (/^第.+章$/.test(chapterNo)) {
    return { id: `chapter-${chapterNo}`, label: chapterNo, sortValue: chapterNo };
  }

  return { id: `chapter-${chapterNo}`, label: chapterNo, sortValue: chapterNo };
}

function sectionGroupFor(chapterNo: string | null): {
  id: string;
  label: string;
  sortValue: string | null;
} {
  if (!chapterNo) return { id: 'section-unassigned', label: '未分节', sortValue: null };
  return { id: `section-${chapterNo}`, label: chapterNo, sortValue: chapterNo };
}

function compareProgressItemsByChapter(a: ProgressItem, b: ProgressItem): number {
  const chapterOrder = compareChapterNo(a.chapterNo, b.chapterNo);
  if (chapterOrder !== 0) return chapterOrder;
  const priority = progressPriority(a) - progressPriority(b);
  if (priority !== 0) return priority;
  return a.name.localeCompare(b.name, 'zh-CN');
}

function compareSortValue(a: string | null, b: string | null): number {
  return compareChapterNo(a, b);
}

function buildPracticeByKp(attemptRows: readonly ProgressAttemptSource[]) {
  const practiceByKp = new Map<string, { count: number; lastPracticedAt: Date }>();
  for (const row of attemptRows) {
    const current = practiceByKp.get(row.kp_id);
    if (!current) {
      practiceByKp.set(row.kp_id, { count: 1, lastPracticedAt: row.answered_at });
      continue;
    }
    practiceByKp.set(row.kp_id, {
      count: current.count + 1,
      lastPracticedAt:
        row.answered_at.getTime() > current.lastPracticedAt.getTime()
          ? row.answered_at
          : current.lastPracticedAt,
    });
  }
  return practiceByKp;
}

function progressPriority(item: ProgressItem): number {
  if (item.status === 'regressed') return 0;
  if (item.status === 'needs_work') return 1;
  if (item.needsReview) return 2;
  if (item.hasOpenMistake) return 3;
  if (item.status === 'learning') return 4;
  if (item.status === 'not_started') return 5;
  return 6;
}

function uniqueSortedChapters(knowledgePoints: readonly ProgressKnowledgePointSource[]): string[] {
  return [...new Set(knowledgePoints.flatMap((kp) => (kp.chapter_no ? [kp.chapter_no] : [])))].sort(
    compareChapterNo,
  );
}

function compareChapterNo(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, 'zh-CN', { numeric: true });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
