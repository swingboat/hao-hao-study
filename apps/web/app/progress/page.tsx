import Link from 'next/link';
import {
  type ProgressFilter,
  type ProgressItem,
  filterProgressItems,
  groupProgressItemsByChapter,
  progressFilterLabel,
  progressStatusLabel,
  textbookOptionLabel,
} from '../../lib/progress';
import { getLearningProgressData } from '../../lib/progress-data';
import { requireCurrentStudent } from '../../lib/student-data';
import { startTodaySessionAction } from '../actions';

export const dynamic = 'force-dynamic';

const PROGRESS_FILTERS: ProgressFilter[] = [
  'all',
  'needs_work',
  'learning',
  'mastered',
  'not_started',
];

interface ProgressPageProps {
  searchParams: Promise<{
    filter?: string;
    chapter?: string;
    textbook?: string;
  }>;
}

export default async function ProgressPage({ searchParams }: ProgressPageProps) {
  const [params, student] = await Promise.all([searchParams, requireCurrentStudent()]);
  const progress = await getLearningProgressData(student, params.textbook);
  const activeFilter = readProgressFilter(params.filter);
  const activeChapter = progress.chapters.includes(params.chapter ?? '')
    ? params.chapter
    : undefined;
  const visibleItems = filterProgressItems(progress.items, activeFilter, activeChapter);
  const groupedItems = groupProgressItemsByChapter(visibleItems);
  const activeTextbookIndex = progress.activeTextbook?.index ?? 0;

  return (
    <main className="page-shell">
      <section className="top-band">
        <div>
          <p className="eyebrow">学习进度</p>
          <h1 className="page-title">学习进度</h1>
          <p className="muted mt-2">
            {progress.activeTextbook
              ? `${textbookOptionLabel(progress.activeTextbook.textbook)} · 看看哪些已经会了，哪些还要继续练。`
              : '看看哪些已经会了，哪些还要继续练。'}
          </p>
        </div>
        <div className="top-actions">
          <Link className="secondary-button" href="/">
            返回首页
          </Link>
          <form action={startTodaySessionAction}>
            <button className="primary-button" type="submit">
              开始今日练习
            </button>
          </form>
        </div>
      </section>

      <section className="progress-summary-grid" aria-label="学习进度汇总">
        <div className="metric-card">
          <span className="metric-label">已解锁知识点</span>
          <strong>{progress.summary.unlockedCount}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">已开始学习</span>
          <strong>{progress.summary.startedCount}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">已掌握</span>
          <strong>{progress.summary.masteredCount}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-label">需要加强</span>
          <strong>{progress.summary.needsWorkCount}</strong>
        </div>
      </section>

      <section className="content-section progress-controls" aria-label="学习进度筛选">
        <div>
          <h2>筛选知识点</h2>
          <p>先选择教材，再查看这本教材下的章节和知识点。</p>
        </div>

        {progress.textbooks.length > 0 ? (
          <div className="textbook-filter-block">
            <span>教材</span>
            <nav className="textbook-filter-list" aria-label="教材筛选">
              {progress.textbooks.map((textbook, index) => (
                <Link
                  aria-current={index === activeTextbookIndex ? 'page' : undefined}
                  className="textbook-filter-link"
                  href={progressHref({ filter: activeFilter, textbookIndex: index })}
                  key={textbook.id}
                >
                  {textbookOptionLabel(textbook)}
                </Link>
              ))}
            </nav>
          </div>
        ) : null}

        <nav className="progress-filter-list" aria-label="掌握状态筛选">
          {PROGRESS_FILTERS.map((filter) => (
            <Link
              aria-current={filter === activeFilter ? 'page' : undefined}
              className="progress-filter-link"
              href={progressHref({
                filter,
                chapter: activeChapter,
                textbookIndex: activeTextbookIndex,
              })}
              key={filter}
            >
              {progressFilterLabel(filter)}
            </Link>
          ))}
        </nav>

        {progress.chapters.length > 0 ? (
          <nav className="chapter-filter-list" aria-label="章节筛选">
            <Link
              aria-current={!activeChapter ? 'page' : undefined}
              className="chapter-filter-link"
              href={progressHref({
                filter: activeFilter,
                textbookIndex: activeTextbookIndex,
              })}
            >
              全部章节
            </Link>
            {progress.chapters.map((chapter) => (
              <Link
                aria-current={chapter === activeChapter ? 'page' : undefined}
                className="chapter-filter-link"
                href={progressHref({
                  filter: activeFilter,
                  chapter,
                  textbookIndex: activeTextbookIndex,
                })}
                key={chapter}
              >
                {chapter}
              </Link>
            ))}
          </nav>
        ) : null}
      </section>

      <section className="progress-list" aria-label="知识点学习进度列表">
        {visibleItems.length === 0 ? (
          <div className="content-section empty-state">
            <h2>没有符合条件的知识点</h2>
            <p>换一个筛选条件，或者先完成一次今日练习。</p>
          </div>
        ) : (
          groupedItems.map((chapter) => (
            <details className="progress-chapter-group" key={chapter.id} open={chapter.defaultOpen}>
              <summary className="progress-chapter-summary">
                <div>
                  <h2>{chapter.label}</h2>
                </div>
                <div className="progress-group-meta">
                  <span>{chapter.itemCount} 个知识点</span>
                  {chapter.needsWorkCount > 0 ? (
                    <span className="danger">{chapter.needsWorkCount} 个需要加强</span>
                  ) : null}
                  {chapter.masteredCount > 0 ? <span>{chapter.masteredCount} 个已掌握</span> : null}
                </div>
              </summary>

              <div className="progress-section-list">
                {chapter.sections.map((section) => (
                  <details
                    className="progress-section-group"
                    key={section.id}
                    open={section.defaultOpen}
                  >
                    <summary className="progress-section-summary">
                      <div>
                        <strong>{section.label}</strong>
                      </div>
                      <div className="progress-group-meta">
                        <span>{section.itemCount} 个知识点</span>
                        {section.needsWorkCount > 0 ? (
                          <span className="danger">{section.needsWorkCount} 个需要加强</span>
                        ) : null}
                        {section.masteredCount > 0 ? (
                          <span>{section.masteredCount} 个已掌握</span>
                        ) : null}
                      </div>
                    </summary>

                    <div className="progress-section-items">
                      {section.items.map((item) => (
                        <ProgressItemCard item={item} key={item.id} />
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))
        )}
      </section>
    </main>
  );
}

function ProgressItemCard({ item }: { item: ProgressItem }) {
  return (
    <article className="progress-card">
      <div className="progress-card-head">
        <div>
          <p className="chapter-label">知识点</p>
          <h2>{item.name}</h2>
        </div>
        <span className="status-pill" data-status={item.status}>
          {progressStatusLabel(item.status)}
        </span>
      </div>

      <div className="mastery-meter" aria-label={`掌握程度 ${item.progressPercent}%`}>
        <div style={{ width: `${item.progressPercent}%` }} />
      </div>

      <div className="progress-card-foot">
        <span>掌握程度 {item.progressPercent}%</span>
        <span>练习 {item.practiceCount} 次</span>
        {item.lastPracticedAt ? <span>最近 {formatDate(item.lastPracticedAt)}</span> : null}
        {item.needsReview ? <span className="reminder-chip">待复习</span> : null}
        {item.hasOpenMistake ? <span className="reminder-chip danger">有错题待巩固</span> : null}
      </div>
    </article>
  );
}

function readProgressFilter(value: string | undefined): ProgressFilter {
  return PROGRESS_FILTERS.includes(value as ProgressFilter) ? (value as ProgressFilter) : 'all';
}

function progressHref({
  filter,
  chapter,
  textbookIndex,
}: {
  filter: ProgressFilter;
  chapter?: string;
  textbookIndex?: number;
}) {
  const params = new URLSearchParams();
  if (textbookIndex && textbookIndex > 0) params.set('textbook', String(textbookIndex));
  if (filter !== 'all') params.set('filter', filter);
  if (chapter) params.set('chapter', chapter);
  const query = params.toString();
  return query ? `/progress?${query}` : '/progress';
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
}
