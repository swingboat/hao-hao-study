/**
 * F4.3 开发期批量动作条 — 仅在 NODE_ENV !== 'production' 渲染。
 *
 * 提供两个高危按钮：
 *   - 「接受全部并发布」→ bulkAcceptAllAction
 *   - 「丢弃全部」      → bulkRejectAllAction
 *
 * 两个按钮都用 onClick confirm 兜底；提交中禁用，结果以 state.error / state.accepted 反馈。
 */
'use client';

import { useActionState } from 'react';
import { type BulkActionState, bulkAcceptAllAction, bulkRejectAllAction } from './actions';

const INITIAL: BulkActionState = { error: null };

export interface DevBulkBarProps {
  uploadId: string;
  pendingCount: number;
}

export function DevBulkBar({ uploadId, pendingCount }: DevBulkBarProps) {
  const [acceptState, acceptAll, accepting] = useActionState(bulkAcceptAllAction, INITIAL);
  const [rejectState, rejectAll, rejecting] = useActionState(bulkRejectAllAction, INITIAL);

  const busy = accepting || rejecting;
  const disabled = busy || pendingCount === 0;

  return (
    <section className="border border-dashed border-amber-500 rounded-lg p-3 text-sm bg-amber-50/40 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wider text-amber-700 dark:text-amber-300">
          DEV 批量
        </span>
        <span className="opacity-70 text-xs">仅开发环境可见；生产由 server action 兜底拒绝</span>

        <form
          action={acceptAll}
          onSubmit={(e) => {
            if (
              !confirm(`确认把当前 ${pendingCount} 条 pending 全部接受并发布到 knowledge_point？`)
            ) {
              e.preventDefault();
            }
          }}
          className="ml-auto"
        >
          <input type="hidden" name="upload_id" value={uploadId} />
          <button
            type="submit"
            disabled={disabled}
            className="px-3 py-1.5 rounded bg-green-600 text-white text-xs font-medium disabled:opacity-40"
          >
            {accepting ? '接受中…' : `接受全部并发布（${pendingCount}）`}
          </button>
        </form>

        <form
          action={rejectAll}
          onSubmit={(e) => {
            if (!confirm(`确认把当前 ${pendingCount} 条 pending 全部丢弃？`)) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="upload_id" value={uploadId} />
          <button
            type="submit"
            disabled={disabled}
            className="px-3 py-1.5 rounded bg-red-600 text-white text-xs font-medium disabled:opacity-40"
          >
            {rejecting ? '丢弃中…' : `丢弃全部（${pendingCount}）`}
          </button>
        </form>
      </div>

      {acceptState.accepted != null ? (
        <p className="mt-2 text-xs text-green-700 dark:text-green-300">
          ✅ 已接受 {acceptState.accepted} 条{acceptState.error ? `；${acceptState.error}` : ''}
        </p>
      ) : null}
      {acceptState.failures && acceptState.failures.length > 0 ? (
        <ul className="mt-1 text-xs text-red-600 list-disc list-inside">
          {acceptState.failures.map((f) => (
            <li key={f.stagingId}>
              <code className="font-mono">{f.stagingId.slice(0, 8)}</code> — {f.reason}
            </li>
          ))}
        </ul>
      ) : null}
      {rejectState.rejected != null ? (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">
          🗑️ 已丢弃 {rejectState.rejected} 条
        </p>
      ) : null}
      {rejectState.error ? <p className="mt-1 text-xs text-red-600">{rejectState.error}</p> : null}
    </section>
  );
}
