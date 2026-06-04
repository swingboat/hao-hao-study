/**
 * F1.1 登录页 — 居中卡片，账号 / 密码 / 登录三元素，错误红字。
 *
 * 用 `useActionState` 让错误文案与表单提交联动；登录成功在 server action 内 redirect。
 */
'use client';

import { useSearchParams } from 'next/navigation';
import { useActionState } from 'react';
import { type LoginState, loginAction } from './actions';

const INITIAL: LoginState = { error: null };

export default function LoginPage() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/admin';
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form
        action={formAction}
        className="w-full max-w-sm border rounded-lg p-6 shadow-sm bg-white dark:bg-neutral-900"
      >
        <h1 className="text-xl font-semibold mb-1">运营端登录</h1>
        <p className="text-xs opacity-60 mb-5">好好学习 · Operator Console v0.1</p>

        <input type="hidden" name="next" value={next} />

        <label className="block text-sm mb-1" htmlFor="username">
          账号
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          required
          className="w-full mb-3 px-3 py-2 border rounded text-sm bg-transparent"
        />

        <label className="block text-sm mb-1" htmlFor="password">
          密码
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full mb-4 px-3 py-2 border rounded text-sm bg-transparent"
        />

        {state.error ? (
          <p className="text-sm text-red-600 mb-3" role="alert">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full py-2 rounded bg-black text-white text-sm font-medium disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {pending ? '登录中…' : '登录'}
        </button>
      </form>
    </main>
  );
}
