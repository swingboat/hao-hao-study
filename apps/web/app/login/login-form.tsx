'use client';

import { useActionState } from 'react';
import { type LoginState, loginAction } from '../actions';

const INITIAL_STATE: LoginState = { error: null };

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL_STATE);

  return (
    <form action={formAction} className="auth-panel">
      <div>
        <p className="eyebrow">web端</p>
        <h1 className="page-title">登录好好学习</h1>
        <p className="muted mt-2">使用老师下发的账号和一次性密码进入今日学习。</p>
      </div>

      <input type="hidden" name="next" value={next} />

      <div className="field-stack">
        <label htmlFor="username">账号</label>
        <input id="username" name="username" autoComplete="username" required />
      </div>

      <div className="field-stack">
        <label htmlFor="password">密码</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {state.error ? (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="primary-button w-full" disabled={pending}>
        {pending ? '登录中...' : '登录'}
      </button>
    </form>
  );
}
