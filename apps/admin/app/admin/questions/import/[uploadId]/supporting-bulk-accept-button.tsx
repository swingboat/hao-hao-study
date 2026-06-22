'use client';

import { useActionState } from 'react';
import { type BulkActionState, bulkAcceptSupportingStagingsAction } from './actions';

const INITIAL: BulkActionState = { error: null };

export function SupportingBulkAcceptButton({
  uploadId,
  subjectId,
  pendingCount,
}: {
  uploadId: string;
  subjectId: string;
  pendingCount: number;
}) {
  const [state, action, pending] = useActionState(bulkAcceptSupportingStagingsAction, INITIAL);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!confirm(`确认接受当前 ${pendingCount} 条来源资料和学习材料？`)) {
          event.preventDefault();
        }
      }}
      className="inline-flex items-center gap-3"
    >
      <input type="hidden" name="upload_id" value={uploadId} />
      <input type="hidden" name="subject_id" value={subjectId} />
      <button
        type="submit"
        disabled={pending || pendingCount === 0}
        className="px-3 py-1.5 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? '接受中…' : '接受所有来源和材料'}
      </button>
      {state.ok ? (
        <span className="text-xs">
          <span className="text-green-700">已接受 {state.accepted ?? 0}</span>
          {state.skipped ? (
            <>
              ，<span className="text-amber-700">跳过 {state.skipped}</span>
              {state.skipReasons && state.skipReasons.length > 0 ? (
                <details className="inline-block ml-2">
                  <summary className="cursor-pointer underline opacity-70">查看原因</summary>
                  <ul className="mt-1 ml-4 list-disc space-y-0.5 text-[11px] opacity-80">
                    {state.skipReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : null}
        </span>
      ) : state.error ? (
        <span className="text-xs text-red-600">{state.error}</span>
      ) : null}
    </form>
  );
}
