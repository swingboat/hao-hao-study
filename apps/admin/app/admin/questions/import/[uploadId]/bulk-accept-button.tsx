/**
 * "接受所有待审"按钮 —— admin 人员快速过题。
 *
 * 服务端用 bulkAcceptAllAction 逐条事务发布，跳过 kp_hints 无法解析 / options 不足等条目，
 * 完成后把 accepted / skipped 数量回显，skipReasons 折叠展开。
 */
'use client';

import { useActionState } from 'react';
import { type BulkActionState, bulkAcceptAllAction } from './actions';

const INITIAL: BulkActionState = { error: null };

export function BulkAcceptButton({
  uploadId,
  pendingCount,
}: { uploadId: string; pendingCount: number }) {
  const [state, action, pending] = useActionState(bulkAcceptAllAction, INITIAL);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (
          !confirm(
            `确认接受当前 ${pendingCount} 条待审题目？\n\n会自动按 kp_hints 在该学科 KP 表里匹配；找不到 KP 的题会自动跳过（保留为 pending）。`,
          )
        ) {
          e.preventDefault();
        }
      }}
      className="inline-flex items-center gap-3"
    >
      <input type="hidden" name="upload_id" value={uploadId} />
      <button
        type="submit"
        disabled={pending || pendingCount === 0}
        className="px-3 py-1.5 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? '接受中…' : `✅ 接受所有（${pendingCount}）`}
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
                    {state.skipReasons.map((r) => (
                      <li key={r}>{r}</li>
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
