/**
 * F4.2 KP 新建 / 编辑模态框。
 *
 *  - 用原生 <dialog> 元素实现（无需引入 UI 库）
 *  - 开关由 URL query 控制：?new=1 / ?edit=<id>，关闭即跳回 /admin/kps
 *    （对 server-rendered modal 友好：不需要把 open 状态推到客户端 state）
 *  - 表单提交走 server action（createKpAction / updateKpAction），
 *    用 useActionState 收集校验错误并红字提示
 */
'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef } from 'react';
import { type KpFormState, createKpAction, updateKpAction } from './actions';

const INITIAL: KpFormState = { error: null };

export interface KpDialogProps {
  /** 'new' 创建 / { ...row } 编辑 / null 不渲染 */
  mode: 'new' | { id: string; name: string; subject_id: string; chapter_no: string | null };
  subjects: Array<{ id: string; name: string }>;
}

export function KpDialog({ mode, subjects }: KpDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const isEdit = mode !== 'new';
  const action = isEdit ? updateKpAction : createKpAction;
  const [state, formAction, pending] = useActionState(action, INITIAL);

  // 挂载即打开 modal；关闭时回跳列表页（清掉 query）
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    const onClose = () => router.push('/admin/kps');
    dlg.addEventListener('close', onClose);
    return () => dlg.removeEventListener('close', onClose);
  }, [router]);

  return (
    <dialog ref={dialogRef} className="rounded-lg p-0 backdrop:bg-black/40 w-full max-w-md">
      <form action={formAction} className="p-6">
        <h2 className="text-lg font-semibold mb-4">{isEdit ? '编辑 KP' : '新建 KP'}</h2>

        {isEdit ? <input type="hidden" name="id" value={mode.id} /> : null}

        <label className="block text-sm mb-1" htmlFor="kp-name">
          名称 <span className="text-red-600">*</span>
        </label>
        <input
          id="kp-name"
          name="name"
          required
          maxLength={100}
          defaultValue={isEdit ? mode.name : ''}
          className="w-full mb-3 px-3 py-2 border rounded text-sm bg-transparent"
        />

        <label className="block text-sm mb-1" htmlFor="kp-subject">
          学科 <span className="text-red-600">*</span>
        </label>
        <select
          id="kp-subject"
          name="subject_id"
          required
          defaultValue={isEdit ? mode.subject_id : (subjects[0]?.id ?? '')}
          className="w-full mb-3 px-3 py-2 border rounded text-sm bg-transparent"
        >
          {subjects.length === 0 ? (
            <option value="">（subject 表为空，请总控先 seed）</option>
          ) : null}
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}（{s.id}）
            </option>
          ))}
        </select>

        <label className="block text-sm mb-1" htmlFor="kp-chapter">
          章节编号 <span className="opacity-50 text-xs">（选填）</span>
        </label>
        <input
          id="kp-chapter"
          name="chapter_no"
          maxLength={50}
          defaultValue={isEdit ? (mode.chapter_no ?? '') : ''}
          className="w-full mb-4 px-3 py-2 border rounded text-sm bg-transparent"
        />

        {state.error ? (
          <p className="text-sm text-red-600 mb-3" role="alert">
            {state.error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="px-3 py-1.5 rounded border text-sm hover:bg-black/5 dark:hover:bg-white/10"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={pending || subjects.length === 0}
            className="px-3 py-1.5 rounded bg-black text-white text-sm font-medium disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {pending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
