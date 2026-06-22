/**
 * /admin 概览首页 — F6.1 看板将在 M9 实装；
 * 当前作为登录后默认落地页，仅提供导航入口。
 */
import Link from 'next/link';

export default function AdminHomePage() {
  return (
    <main className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">admin端控制台</h1>
      <p className="text-sm opacity-60 mb-6">v0.1 MVP — F1/F2/F3/F4/F5.1 已上线</p>

      <ul className="grid gap-3 sm:grid-cols-2">
        <li className="border rounded-lg p-4">
          <Link href="/admin/settings/llm" className="font-medium underline">
            LLM Provider 配置（F2）
          </Link>
          <p className="text-xs opacity-60 mt-1">查看 / 启停 Provider，查看默认绑定。</p>
        </li>
        <li className="border rounded-lg p-4">
          <Link href="/admin/kps" className="font-medium underline">
            知识点维护（F4）
          </Link>
          <p className="text-xs opacity-60 mt-1">
            列出 / 新建 / 编辑 KP；F3 解析将复用其作为词典。
          </p>
        </li>
        <li className="border rounded-lg p-4">
          <Link href="/admin/questions" className="font-medium underline">
            试题库（F3）
          </Link>
          <p className="text-xs opacity-60 mt-1">
            题集 PDF → LLM 抽题 → 审核入库；按 KP 分组浏览。
          </p>
        </li>
        <li className="border rounded-lg p-4">
          <Link href="/admin/students" className="font-medium underline">
            学生列表（F5.1）
          </Link>
          <p className="text-xs opacity-60 mt-1">查看已初始化学生的基础字段和解锁 KP 数量。</p>
        </li>
      </ul>
    </main>
  );
}
