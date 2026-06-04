/**
 * F1 路由守卫 — 任何未带有效 session 的 /admin 访问，重定向到 /admin/login。
 *
 * 注意：
 *  - middleware 跑在 Edge runtime，不能 import 任何带 Node 内置依赖的代码（如 bcrypt）。
 *    `verifySession` 只用 jose（Edge 兼容），故 OK。
 *  - 静态资源（_next、favicon、images）通过 matcher 排除，避免每次请求都验签。
 *  - /admin/login 与 /admin/api/auth/login 必须放行，否则进不来。
 */
import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from './lib/auth';

const PUBLIC_PATHS = ['/admin/login', '/admin/api/auth/login'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 仅守 /admin/*；根路径会在 page 层 redirect
  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (session) {
    return NextResponse.next();
  }

  // 未登录，跳转登录页（保留 next= 以便登录后回原页）
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/admin/login';
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // 排除静态资源；其余请求都过守卫
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
