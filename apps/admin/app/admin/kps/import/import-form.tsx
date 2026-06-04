/**
 * F4.3 上传表单（client 组件）。
 *
 * 用 useActionState 接 server action 的报错文案。
 * 提交时 pending=true，按钮 disabled + 提示"上传并解析中（最长可能 60s）"，
 * 因为 action 内部同步 await callLLM。
 */
'use client';

import { useActionState } from 'react';
import { type UploadFormState, uploadAndParseAction } from './actions';

const INITIAL: UploadFormState = { error: null };

export interface ImportFormProps {
  subjects: Array<{ id: string; name: string; stage: string }>;
  providers: Array<{ id: string; model: string }>;
  defaultProvider: string;
}

export function ImportForm({ subjects, providers, defaultProvider }: ImportFormProps) {
  const [state, formAction, pending] = useActionState(uploadAndParseAction, INITIAL);

  return (
    <form
      action={formAction}
      className="border rounded-lg p-5 space-y-4"
      encType="multipart/form-data"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm mb-1" htmlFor="subject_id">
            学科 <span className="text-red-600">*</span>
          </label>
          <select
            id="subject_id"
            name="subject_id"
            required
            defaultValue={subjects[0]?.id ?? ''}
            className="w-full px-3 py-2 border rounded text-sm bg-transparent"
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}（{s.id} / {s.stage}）
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1" htmlFor="provider_id">
            LLM Provider <span className="text-red-600">*</span>
          </label>
          <select
            id="provider_id"
            name="provider_id"
            required
            defaultValue={defaultProvider}
            className="w-full px-3 py-2 border rounded text-sm bg-transparent"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}（{p.model}）
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm mb-1" htmlFor="file">
          PDF 文件 <span className="text-red-600">*</span>
          <span className="opacity-50 text-xs ml-2">≤ 20MB；超大教材请按章拆分后多次上传</span>
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          required
          className="w-full text-sm"
        />
      </div>

      {state.error ? (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded bg-black text-white text-sm font-medium disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {pending ? '上传并解析中…（最长 ~60s）' : '上传并开始解析'}
        </button>
        {pending ? (
          <span className="text-xs opacity-60">请勿关闭页面；解析完成会自动跳转到审核页。</span>
        ) : null}
      </div>
    </form>
  );
}
