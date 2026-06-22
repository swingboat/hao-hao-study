'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { type TextbookFilterGroup, buildTextbookSelectState } from '../../../lib/kp-filters';

export interface KpFilterSubject {
  id: string;
  name: string;
}

export interface KpFilterTextbook extends TextbookFilterGroup {
  originalName: string | null;
  createdAtIso: string;
}

interface KpFilterFormProps {
  subjects: KpFilterSubject[];
  textbookGroups: KpFilterTextbook[];
  currentSubject: string;
  currentTextbook: string;
  view: 'list' | 'tree';
  selectedKpId: string;
}

function textbookLabel(textbook: KpFilterTextbook, subjects: KpFilterSubject[]): string {
  const subjectName = subjects.find((subject) => subject.id === textbook.subjectId)?.name;
  const display = textbook.originalName ?? `<未命名>·${textbook.canonicalId.slice(0, 8)}`;
  const date = new Date(textbook.createdAtIso).toLocaleDateString('zh-CN');
  const dupSuffix = textbook.uploadIds.length > 1 ? ` · 上传 ${textbook.uploadIds.length} 次` : '';

  return `${subjectName ? `[${subjectName}] ` : ''}${display}（${date}${dupSuffix}）`;
}

export function KpFilterForm({
  subjects,
  textbookGroups,
  currentSubject,
  currentTextbook,
  view,
  selectedKpId,
}: KpFilterFormProps) {
  const [subject, setSubject] = useState(currentSubject);
  const [textbook, setTextbook] = useState(currentTextbook);
  const textbookState = useMemo(
    () => buildTextbookSelectState(subject, textbook, textbookGroups),
    [subject, textbook, textbookGroups],
  );
  const selectedTextbook = textbookState.value;

  const buildViewLink = (target: 'list' | 'tree') => {
    const qp = new URLSearchParams();
    if (selectedTextbook) qp.set('textbook', selectedTextbook);
    if (subject) qp.set('subject', subject);
    if (selectedKpId) qp.set('kp', selectedKpId);
    if (target === 'list') qp.set('view', 'list');
    const qs = qp.toString();
    return qs ? `/admin/kps?${qs}` : '/admin/kps';
  };

  return (
    <form
      action="/admin/kps"
      autoComplete="off"
      className="mb-4 flex flex-wrap items-center gap-2 text-sm"
    >
      <label htmlFor="subject-filter" className="opacity-70">
        学科：
      </label>
      <select
        id="subject-filter"
        name="subject"
        value={subject}
        onChange={(event) => {
          setSubject(event.target.value);
          setTextbook('');
        }}
        className="px-2 py-1 border rounded bg-transparent"
      >
        <option value="">全部</option>
        {subjects.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}（{item.id}）
          </option>
        ))}
      </select>

      <label htmlFor="textbook-filter" className="ml-2 opacity-70">
        教材：
      </label>
      <select
        id="textbook-filter"
        name="textbook"
        value={selectedTextbook}
        onChange={(event) => setTextbook(event.target.value)}
        disabled={textbookState.disabled}
        className={`px-2 py-1 border rounded bg-transparent min-w-64 ${
          textbookState.disabled ? 'opacity-60 cursor-not-allowed' : ''
        }`}
      >
        <option value="">{textbookState.placeholder}</option>
        {textbookState.textbooks.map((item) => (
          <option key={item.canonicalId} value={item.canonicalId}>
            {textbookLabel(item, subjects)}
          </option>
        ))}
      </select>
      {view === 'list' ? <input type="hidden" name="view" value="list" /> : null}
      <button
        type="submit"
        className="px-2 py-1 rounded border text-xs hover:bg-black/5 dark:hover:bg-white/10"
      >
        应用
      </button>
      {selectedTextbook || subject ? (
        <Link
          href={view === 'list' ? '/admin/kps?view=list' : '/admin/kps'}
          className="text-xs opacity-60 hover:opacity-100"
        >
          清除筛选
        </Link>
      ) : null}
      {subject && textbookState.textbooks.length === 0 ? (
        <span className="text-xs text-amber-600 ml-2">该学科下还没有上传教材</span>
      ) : null}

      <span className="ml-auto inline-flex border rounded overflow-hidden text-xs">
        <Link
          href={buildViewLink('tree')}
          aria-current={view === 'tree' ? 'page' : undefined}
          className={`px-2 py-1 ${
            view === 'tree'
              ? 'bg-black text-white dark:bg-white dark:text-black'
              : 'hover:bg-black/5 dark:hover:bg-white/10'
          }`}
        >
          🌲 章节树
        </Link>
        <Link
          href={buildViewLink('list')}
          aria-current={view === 'list' ? 'page' : undefined}
          className={`px-2 py-1 border-l ${
            view === 'list'
              ? 'bg-black text-white dark:bg-white dark:text-black'
              : 'hover:bg-black/5 dark:hover:bg-white/10'
          }`}
        >
          ☰ 列表
        </Link>
      </span>
    </form>
  );
}
