/**
 * /admin 概览首页 — F6.1 看板将在 M9 实装；
 * 当前作为登录后默认落地页，仅显示项目状态占位。
 */
export default function AdminHomePage() {
  return (
    <main className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">运营端控制台</h1>
      <p className="text-sm opacity-60 mb-6">v0.1 MVP — F1 已上线，F2–F7 按里程碑陆续交付</p>

      <section className="border rounded-lg p-4">
        <h2 className="font-medium mb-2">交付状态</h2>
        <ul className="text-sm space-y-1 list-disc list-inside opacity-80">
          <li>F1 鉴权 — 完成（登录 / 12h session / 登出）</li>
          <li>F2 LLM Provider 配置 — 待实现</li>
          <li>F3 题库导入解析管线 — 待实现（M7）</li>
          <li>F4 知识点维护 — 待实现</li>
          <li>F5 学生开户 — 待实现（M8）</li>
          <li>F6 看板 / F7 审计 — 待实现（M9）</li>
        </ul>
      </section>
    </main>
  );
}
