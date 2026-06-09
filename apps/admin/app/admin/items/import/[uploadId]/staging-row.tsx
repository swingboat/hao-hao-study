/**
 * F3.3 staging 单行 — 列出题摘要 + 答案 + kp_hints；点击"查看 / 编辑"打开 DiffDrawer（F3.4 / F3.5）。
 * 行内不直接编辑（题字段太多）；接受 / 丢弃也都在抽屉里完成，行内只有"丢弃（快捷）"。
 */
'use client';

import { useState } from 'react';
import { rejectStagingAction } from './actions';
import { DiffDrawer, type LlmItemPayload } from './diff-drawer';

export interface StagingRowProps {
  stagingId: string;
  uploadId: string;
  payload: LlmItemPayload;
  subjectId: string;
  subjectLabel: string;
  providers: Array<{ id: string; model: string }>;
}

export function StagingRow(props: StagingRowProps) {
  const [open, setOpen] = useState(false);
  const { payload } = props;
  const summary = (payload.content ?? '').replace(/\s+/g, ' ').slice(0, 80);

  return (
    <div className="border rounded-lg p-3">
      <div className="flex items-baseline gap-2 mb-2 text-xs opacity-60">
        <span>学科：{props.subjectLabel}</span>
        <span className="font-mono">staging:{props.stagingId.slice(0, 8)}</span>
        <span>· 题型 {payload.item_type ?? '?'}</span>
        <span>· 难度 {payload.difficulty ?? '?'}</span>
        {payload.source_hint?.page ? <span>· 原文 p{payload.source_hint.page}</span> : null}
        {payload.source_hint?.item_no ? <span>· {payload.source_hint.item_no}</span> : null}
      </div>

      <p className="text-sm">
        {summary}
        {summary.length >= 80 ? '…' : ''}
      </p>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>
          <span className="opacity-60">答案</span>{' '}
          <code className="font-mono">{payload.answer ?? '—'}</code>
        </span>
        <span>
          <span className="opacity-60">kp_hints</span>{' '}
          {payload.kp_hints && payload.kp_hints.length > 0
            ? payload.kp_hints.map((h) => (
                <span
                  key={h}
                  className="inline-block px-1.5 py-0.5 mr-1 rounded bg-black/5 dark:bg-white/10"
                >
                  {h}
                </span>
              ))
            : '—'}
        </span>
        {payload.figures && payload.figures.length > 0 ? (
          <span className="opacity-60">含图 ×{payload.figures.length}</span>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 rounded bg-black text-white text-xs font-medium dark:bg-white dark:text-black"
        >
          查看 / 编辑 / 接受
        </button>
        <form
          action={rejectStagingAction}
          onSubmit={(e) => {
            if (!confirm('确认丢弃这条 staging？')) e.preventDefault();
          }}
        >
          <input type="hidden" name="staging_id" value={props.stagingId} />
          <input type="hidden" name="upload_id" value={props.uploadId} />
          <button
            type="submit"
            className="text-xs px-2 py-1 rounded border opacity-70 hover:opacity-100"
          >
            丢弃
          </button>
        </form>
      </div>

      {open ? (
        <DiffDrawer
          stagingId={props.stagingId}
          uploadId={props.uploadId}
          payload={payload}
          subjectId={props.subjectId}
          subjectLabel={props.subjectLabel}
          providers={props.providers}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
