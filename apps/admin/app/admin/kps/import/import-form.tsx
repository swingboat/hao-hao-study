/**
 * F4.3 上传表单（client 组件）。
 *
 * Server action 现在是「上传完文件 → 预创建 job(queued) → fire-and-forget 后台跑解析 →
 * 立刻 redirect 到 staging 页」。pending=true 只覆盖文件上传 + DB 写入这一小段，
 * 真实 chunk 进度由 staging 页的 JobProgressPoller 接管。
 *
 * 提交时附 onSubmit 拦截 + console.info，方便排查「点了按钮但没反应」类问题：
 * 若 console 没看到 "[ImportForm] submit"，说明浏览器原生 form validation 把请求拦了
 * （比如 required 字段为空）；若看到了但 Network 没 POST，说明 React server-action
 * 客户端转换层出错；都没问题就看 server 端 [uploadAndParseAction] 日志。
 *
 * 文件输入用一个大可点击的拖放区包住原生 <input type="file">（label 关联 input.id 即可
 * 让整个区域接管点击），原生按钮 sr-only 隐藏；选完文件后展示文件名 + 大小。
 */
'use client';

import { useActionState, useEffect, useState } from 'react';
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

  useEffect(() => {
    console.info('[ImportForm] pending =', pending, 'state =', state);
  }, [pending, state]);

  return (
    <>
      <form
        action={formAction}
        onSubmit={(e) => {
          const f = e.currentTarget;
          const file = f.querySelector<HTMLInputElement>('input[name="file"]')?.files?.[0];
          console.info('[ImportForm] submit', {
            file_name: file?.name,
            file_size: file?.size,
            subject_id: f.querySelector<HTMLSelectElement>('select[name="subject_id"]')?.value,
            provider_id: f.querySelector<HTMLSelectElement>('select[name="provider_id"]')?.value,
          });
        }}
        className="border rounded-lg p-5 space-y-5"
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

        {/* 大可点击的文件拖放/选择区。label htmlFor 绑定 input.id，整块都能点开文件选择器。 */}
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
                  点击选择 PDF 文件 <span className="text-red-600">*</span>
                </p>
                <p className="text-xs opacity-60">
                  ≤ 500MB · analyzePdf 会按 15 页/片自动切割发给 LLM
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
            className="px-5 py-2.5 rounded-md bg-blue-600 text-white text-sm font-medium shadow-sm transition-colors hover:bg-blue-700 active:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-blue-600"
          >
            {pending ? '上传中…' : '上传并开始解析'}
          </button>
          <span className="text-xs opacity-60">
            {pickedFile
              ? '上传后会立刻跳转到审核页，解析在后台跑，进度实时可见。'
              : '先在上方选一个 PDF 文件，按钮才会启用。'}
          </span>
        </div>
      </form>

      {pending ? <UploadingOverlay /> : null}
    </>
  );
}

function UploadingOverlay() {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center"
      aria-live="polite"
    >
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl p-8 max-w-md text-center space-y-3">
        <div className="flex justify-center">
          <svg
            className="animate-spin h-10 w-10 text-blue-600"
            viewBox="0 0 24 24"
            fill="none"
            role="img"
            aria-label="上传中"
          >
            <title>上传中</title>
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="4"
            />
            <path fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold">正在上传 PDF…</h2>
        <p className="text-sm opacity-70">
          上传完会自动跳转到审核页，解析进度会在那里实时显示。
          <br />
          大文件请耐心等待（500MB 量级可能需要 1-2 分钟）。
        </p>
      </div>
    </div>
  );
}
