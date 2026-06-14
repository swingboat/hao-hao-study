/**
 * F4.1+ KP 树形视图 — 按 (subject_id → chapter_no → KP) 二层折叠展示。
 *
 *  - server component（page.tsx 已经在 server 拿到了所有 KpRow）
 *  - 折叠用原生 <details>，不需要 client state；刷新仍保留 URL 维度（subject/view）
 *  - 章节排序：localeCompare(numeric:true) → "§1.1 < §1.2 < §2.1 < §10.1"；
 *    chapter_no 为 null 的归"未分类"，固定排在末尾
 *  - 选了 subject filter 时只展示 chapter 这一层（少一层视觉噪音）
 *  - 每章显示 KP 数 + 关联题数小计；树叶节点的"编辑"按钮链接和 list 模式一致
 */
import Link from 'next/link';

export interface KpRow {
  id: string;
  name: string;
  subject_id: string;
  chapter_no: string | null;
  question_count: number;
  student_count: number;
}

const UNGROUPED_KEY = '__未分类__';
const UNGROUPED_LABEL = '（未分类）';

/**
 * chapter_no 是 LLM 抽到的原始文本（已经过 actions.ts normalizeChapterNo 归一为阿拉伯数字段）。
 * 显示规则：
 *   - 纯数字 "6" → "第 6 章"（一级章）
 *   - "6.1" / "6.1.2" → "§ 6.1" / "§ 6.1.2"（节 / 条目）
 *   - 其他非数字开头的（极少见，归一失败漏网）原样展示
 * 注意：本视图是平铺的——"6" / "6.1" / "6.1.1" 并列三层，不做嵌套；同册的 chapter_no
 * 已按 chapterCompare 数值排序，所以"6" 总在 "6.1" 之前，"6.1" 在 "6.1.1" 之前。
 */
function formatChapterLabel(chapter: string): string {
  const s = chapter.trim();
  if (/^\d+$/.test(s)) return `第 ${s} 章`;
  if (/^\d+(\.\d+)+$/.test(s)) return `§ ${s}`;
  return s;
}

function chapterCompare(a: string, b: string): number {
  // 把 UNGROUPED 永远排末尾
  if (a === UNGROUPED_KEY) return 1;
  if (b === UNGROUPED_KEY) return -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

interface ChapterGroup {
  chapter: string; // raw chapter_no 或 UNGROUPED_KEY
  kps: KpRow[];
  questionTotal: number;
  studentMax: number; // 章节级"覆盖学生数"取下属 KP 中最大（学生集合不可加）
}

interface SubjectGroup {
  subjectId: string;
  subjectName: string;
  chapters: ChapterGroup[];
  kpTotal: number;
}

function groupKps(kps: KpRow[], subjectIdToName: Map<string, string>): SubjectGroup[] {
  const bySubject = new Map<string, Map<string, KpRow[]>>();
  for (const k of kps) {
    const chapKey = k.chapter_no && k.chapter_no.trim() !== '' ? k.chapter_no : UNGROUPED_KEY;
    let subjMap = bySubject.get(k.subject_id);
    if (!subjMap) {
      subjMap = new Map();
      bySubject.set(k.subject_id, subjMap);
    }
    const arr = subjMap.get(chapKey);
    if (arr) {
      arr.push(k);
    } else {
      subjMap.set(chapKey, [k]);
    }
  }

  const result: SubjectGroup[] = [];
  for (const [subjectId, chapMap] of bySubject) {
    const chapters: ChapterGroup[] = [];
    let kpTotal = 0;
    for (const [chapter, items] of chapMap) {
      // 章内 KP 按 name 字典序（list 模式也是这个序）
      items.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      const questionTotal = items.reduce((s, k) => s + k.question_count, 0);
      const studentMax = items.reduce((m, k) => Math.max(m, k.student_count), 0);
      chapters.push({ chapter, kps: items, questionTotal, studentMax });
      kpTotal += items.length;
    }
    chapters.sort((a, b) => chapterCompare(a.chapter, b.chapter));
    result.push({
      subjectId,
      subjectName: subjectIdToName.get(subjectId) ?? subjectId,
      chapters,
      kpTotal,
    });
  }
  result.sort((a, b) => a.subjectId.localeCompare(b.subjectId));
  return result;
}

function ChapterBlock({
  group,
  chapterTitles,
  showCheckmark,
}: {
  group: ChapterGroup;
  /** chapter_no → 文字标题（v3+ 数据才有；缺失时只显示编号）。可选；undefined = 全无标题 */
  chapterTitles?: Map<string, string>;
  /** 默认展开（教研一进来想看全貌） */
  showCheckmark?: boolean;
}) {
  const label =
    group.chapter === UNGROUPED_KEY ? UNGROUPED_LABEL : formatChapterLabel(group.chapter);
  // 章节文字标题（如 "平面向量及其应用"）；只对真实 chapter 显示，UNGROUPED 不挂
  const title = group.chapter === UNGROUPED_KEY ? undefined : chapterTitles?.get(group.chapter);
  return (
    <details open className="border-t first:border-t-0">
      <summary className="cursor-pointer px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5 select-none flex items-center gap-3 text-sm">
        <span className="font-medium">{label}</span>
        {title ? <span className="font-medium">{title}</span> : null}
        <span className="opacity-60 text-xs tabular-nums">
          {group.kps.length} 条 KP · 题 {group.questionTotal}
          {group.studentMax > 0 ? ` · 学生峰值 ${group.studentMax}` : ''}
        </span>
        {showCheckmark ? <span className="ml-auto text-xs opacity-40">▾</span> : null}
      </summary>
      <ul className="bg-black/[0.02] dark:bg-white/[0.02]">
        {group.kps.map((k) => (
          <li
            key={k.id}
            className="flex items-center gap-3 px-3 py-1.5 pl-8 text-sm border-t border-black/5 dark:border-white/5"
          >
            <span className="flex-1 truncate" title={k.name}>
              {k.name}
            </span>
            <span className="opacity-60 text-xs tabular-nums whitespace-nowrap">
              题 {k.question_count} · 生 {k.student_count}
            </span>
            <Link
              href={`/admin/kps?edit=${k.id}`}
              className="px-2 py-0.5 rounded border text-xs hover:bg-black/5 dark:hover:bg-white/10"
            >
              编辑
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

export interface KpTreeViewProps {
  kps: KpRow[];
  subjects: Array<{ id: string; name: string }>;
  /** 当前学科过滤（非空 → 只展示一层，省掉 subject 标题） */
  filteredSubject?: string;
  /** chapter_no → 文字标题（缺标题章节显示数字） */
  chapterTitles?: Map<string, string>;
}

export function KpTreeView({ kps, subjects, filteredSubject, chapterTitles }: KpTreeViewProps) {
  const subjectIdToName = new Map(subjects.map((s) => [s.id, s.name]));
  const groups = groupKps(kps, subjectIdToName);

  // 单 subject 直接展平：用户已经选了学科，再嵌一层 subject 节点冗余
  if (filteredSubject && groups.length <= 1) {
    const only = groups[0];
    if (!only) return null;
    return (
      <div className="border rounded-lg overflow-hidden">
        {only.chapters.map((c) => (
          <ChapterBlock
            key={`${only.subjectId}::${c.chapter}`}
            group={c}
            chapterTitles={chapterTitles}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((s) => (
        <details key={s.subjectId} open className="border rounded-lg overflow-hidden">
          <summary className="cursor-pointer px-3 py-2 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 select-none flex items-center gap-3 text-sm">
            <span className="font-semibold">{s.subjectName}</span>
            <code className="text-xs opacity-60">{s.subjectId}</code>
            <span className="opacity-60 text-xs tabular-nums">
              {s.kpTotal} 条 KP · {s.chapters.length} 章
            </span>
          </summary>
          <div>
            {s.chapters.map((c) => (
              <ChapterBlock
                key={`${s.subjectId}::${c.chapter}`}
                group={c}
                chapterTitles={chapterTitles}
              />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
