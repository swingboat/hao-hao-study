import { cookies } from 'next/headers';
/**
 * /admin 受保护区域的共享布局：
 *   - 顶栏：站点名 + 主导航（设置 / 题库 / 学生 / 看板 / 审计） + 右上角"管理员 / 登出"
 *   - middleware 已保证进入这里的请求都已登录；这里再读一次 session 仅用于显示用户名
 *   - /admin/login 不会复用此 layout（位于同级路由，但 layout 仅作用于子树）
 */
import Link from 'next/link';
import { SESSION_COOKIE, verifySession } from '../../lib/auth';
import { logoutAction } from './login/actions';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);

  // 登录页本身不会渲染 layout 的子节点（它在 /admin/login，是 layout 的子树，
  // 所以这里仍会包裹）。我们用 session 是否存在来判断是否渲染顶栏。
  if (!session) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b px-4 h-12 flex items-center justify-between text-sm">
        <nav className="flex items-center gap-4">
          <Link href="/admin" className="font-semibold">
            好好学习 · admin端
          </Link>
          <Link href="/admin/settings/llm" className="opacity-70 hover:opacity-100">
            LLM 设置
          </Link>
          <Link href="/admin/kps" className="opacity-70 hover:opacity-100">
            知识点
          </Link>
          <Link href="/admin/questions" className="opacity-70 hover:opacity-100">
            试题
          </Link>
          <Link href="/admin/students" className="opacity-70 hover:opacity-100">
            学生
          </Link>
        </nav>
        <form action={logoutAction} className="flex items-center gap-3">
          <span className="opacity-70">管理员 / {session.sub}</span>
          <button
            type="submit"
            className="px-2 py-1 rounded border text-xs hover:bg-black/5 dark:hover:bg-white/10"
          >
            登出
          </button>
        </form>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
