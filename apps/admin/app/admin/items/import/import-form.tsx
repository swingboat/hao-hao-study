/**
 * F3.1 / F3.2 上传表单（client 组件） — 与 apps/admin/app/admin/kps/import/import-form.tsx 同构。
 * server action 异步：上传完即刻 redirect 到 staging 页，进度由 poller 接管。
 */
'use client';

import { useActionState, useState } from 'react';
import { type UploadFormState, uploadAndParseAction } from './actions';

const INITIAL: UploadFormState = { error: null };

export interface ImportFormProps {
  subjects: Array<{ id: string; name: string; stage: string }>;
  providers: Array<{ id: string; model: string }>;
  defaultProvider: string;
}

export function ImportForm({ subjects, providers, defaultProvider }: ImportFormProps) {
  const [state, formAction, pending] = useActionState(uploadAndParseAction, INITIAL);
  const [pickedFile, setPickedFile] = useState<{ name: string; size: number } | null>(null);

  return (
    <>
      <form action={formAction} className="border rounded-lg p-5 space-y-5">
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
          <label
            htmlFor="file"
            className="group flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 dark:border-neutral-700 px-6 py-10 cursor-pointer transition-colors bg-neutral-50/40 dark:bg-neutral-900/40 hover:border-blue-500 hover:bg-blue-50/60 dark:hover:bg-blue-950/30"
          >
            <svg
              className="w-10 h-10 text-neutral-400 group-hover:text-blue-600 transition-colors"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              role="img"
              aria-label="上传图标"
            >
              <title>上传图标</title>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {pickedFile ? (
              <>
                <p className="text-sm font-medium">
                  已选：<span className="font-mono">{pickedFile.name}</span>
                </p>
                <p className="text-xs opacity-60">
                  {(pickedFile.size / 1024 / 1024).toFixed(2)} MB · 点击更换文件
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">
                  点击选择题集 PDF <span className="text-red-600">*</span>
                </p>
                <p className="text-xs opacity-60">
                  ≤ 50MB · L2 extractItemsFromPdf 按 3 页/片切，跨页题自动重抽
                </p>
              </>
            )}
            <input
              id="file"
              name="file"
              type="file"
              accept="application/pdf,.pdf"
              required
              className="sr-only"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                setPickedFile(f ? { name: f.name, size: f.size } : null);
              }}
            />
          </label>
        </div>

        {state.error ? (
          <p className="text-sm text-red-600" role="alert">
            ⚠️ {state.error}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending || !pickedFile}
            className="px-5 py-2.5 rounded-md bg-blue-600 text-white text-sm font-medium shadow-sm transition-colors hover:bg-blue-700 active:bg-blue-800 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-blue-600"
          >
            {pending ? '上传中…' : '上传并开始解析'}
          </button>
          <span className="text-xs opacity-60">
            {pickedFile ? '上传完会自动跳转到审核页。' : '先选一个 PDF 文件。'}
          </span>
        </div>
      </form>
    </>
  );
}
