/**
 * 运营端骨架首页 — F1–F7 业务由 Claude B 在 worktrees/admin 实现。
 * 本页仅用于验证 monorepo 与 Next.js 启动正常。
 */
export default function HomePage() {
  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">好好学习 · 运营端</h1>
      <p className="text-sm opacity-60 mb-6">
        Operator Console v0.1 — 骨架页面，业务由 Claude B 在 <code>worktrees/admin</code> 实现
      </p>

      <section className="border rounded-lg p-4 mb-4">
        <h2 className="font-semibold mb-2">脚手架自检</h2>
        <ul className="text-sm space-y-1 list-disc list-inside opacity-80">
          <li>Next.js 15 App Router ✓</li>
          <li>React 19 ✓</li>
          <li>Tailwind CSS 4 ✓</li>
          <li>workspace 引用：@hao/db / @hao/shared / @hao/llm / @hao/ui ✓</li>
        </ul>
      </section>

      <section className="border rounded-lg p-4">
        <h2 className="font-semibold mb-2">下一步</h2>
        <p className="text-sm opacity-80">
          按 <code>docs/PRD/Operator_Console_MVP_PRD.md</code> 实现 F1–F7（共 18 个 TAV
          原子功能）。Claude B 启动入口：
        </p>
        <pre className="bg-black/5 dark:bg-white/5 rounded p-2 mt-2 text-xs">
{`cd worktrees/admin && claude`}
        </pre>
      </section>
    </main>
  );
}
