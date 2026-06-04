/**
 * F1.1 / F1.2 — 登录 / 登出 server actions。
 *
 * 登录成功 → 写 HTTP-only cookie + redirect 到 next 参数 / `/admin`。
 * 登录失败 → 通过 useActionState 返回错误文案，页面红字提示。
 */
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, SESSION_TTL_SEC, signSession, verifyCredentials } from '../../../lib/auth';

export interface LoginState {
  error: string | null;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/admin');

  if (!username || !password) {
    return { error: '请填写账号和密码' };
  }

  const ok = await verifyCredentials(username, password);
  if (!ok) {
    return { error: '账号或密码错误' };
  }

  const token = await signSession(username);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SEC,
  });

  // next 仅允许同站 /admin 路径，防 open redirect
  const safeNext = next.startsWith('/admin') ? next : '/admin';
  redirect(safeNext);
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect('/admin/login');
}
