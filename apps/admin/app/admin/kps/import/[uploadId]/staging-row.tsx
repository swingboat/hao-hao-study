/**
 * F4.3 staging 单行 — client 组件，提供：
 *   - 行内编辑 name / chapter_no（subject_id 通过 hidden 字段透传，无下拉避免改学科）
 *   - "接受并发布" → acceptStagingAction
 *   - "丢弃" → rejectStagingAction（不带 useActionState，直接表单提交）
 *
 * 接受成功后由 server action 触发 revalidatePath，整页 re-render，行消失。
 */
'use client';

import { useActionState } from 'react';
import { type StagingActionState, acceptStagingAction, rejectStagingAction } from './actions';

const INITIAL: StagingActionState = { error: null };

export interface StagingRowProps {
  stagingId: string;
  uploadId: string;
  initialName: string;
  initialChapterNo: string;
  brief: string;
  subjectId: string;
  subjectLabel: string;
}

export function StagingRow({
  stagingId,
  uploadId,
  initialName,
  initialChapterNo,
  brief,
  subjectId,
  subjectLabel,
}: StagingRowProps) {
  const [state, acceptAction, accepting] = useActionState(acceptStagingAction, INITIAL);

  return (
    <div className="border rounded-lg p-3">
      <div className="flex items-baseline gap-2 mb-2 text-xs opacity-60">
        <span>学科：{subjectLabel}</span>
        <span className="font-mono">staging:{stagingId.slice(0, 8)}</span>
      </div>

      <form action={acceptAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="staging_id" value={stagingId} />
        <input type="hidden" name="upload_id" value={uploadId} />
        <input type="hidden" name="subject_id" value={subjectId} />

        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs opacity-70 mb-1" htmlFor={`name-${stagingId}`}>
            知识点名称 <span className="text-red-600">*</span>
          </label>
          <input
            id={`name-${stagingId}`}
            name="name"
            required
            minLength={2}
            maxLength={50}
            defaultValue={initialName}
            className="w-full px-2 py-1.5 border rounded text-sm bg-transparent"
          />
        </div>

        <div className="w-32">
          <label className="block text-xs opacity-70 mb-1" htmlFor={`chap-${stagingId}`}>
            章节
          </label>
          <input
            id={`chap-${stagingId}`}
            name="chapter_no"
            maxLength={20}
            defaultValue={initialChapterNo}
            className="w-full px-2 py-1.5 border rounded text-sm bg-transparent"
          />
        </div>

        <button
          type="submit"
          disabled={accepting}
          className="px-3 py-1.5 rounded bg-black text-white text-xs font-medium disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {accepting ? '接受中…' : '接受并发布'}
        </button>
      </form>

      <form action={rejectStagingAction} className="mt-2 inline">
        <input type="hidden" name="staging_id" value={stagingId} />
        <input type="hidden" name="upload_id" value={uploadId} />
        <button
          type="submit"
          className="text-xs px-2 py-1 rounded border opacity-70 hover:opacity-100"
        >
          丢弃
        </button>
      </form>

      {brief ? <p className="mt-2 text-xs opacity-70 italic">{brief}</p> : null}
      {state.error ? (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
