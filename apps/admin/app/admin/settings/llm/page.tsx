/**
 * F2 LLM Provider 配置页。
 *   - F2.1：列出 llm_provider 全表，行末"启用 / 停用"切换。
 *   - F2.2：默认 Provider 绑定。v0.1 schema 暂无承载表，先用 env 只读展示
 *           （DEFAULT_PROVIDER_QUESTION / DEFAULT_PROVIDER_KNOWLEDGE_POINT /
 *            DEFAULT_PROVIDER_GOAL_TEMPLATE）。后续总控加 admin_setting 表后改为可写。
 */
import { prisma } from '@hao/db';
import { toggleProviderAction } from './actions';

export const dynamic = 'force-dynamic';

const TASK_KIND_LABELS: Record<string, string> = {
  question: '题目解析默认',
  knowledge_point: '知识点解析默认',
  goal_template: 'Goal Template 解析默认',
};

const DEFAULT_ENV_KEYS: Record<string, string> = {
  question: 'DEFAULT_PROVIDER_QUESTION',
  knowledge_point: 'DEFAULT_PROVIDER_KNOWLEDGE_POINT',
  goal_template: 'DEFAULT_PROVIDER_GOAL_TEMPLATE',
};

interface CapabilityFlags {
  text?: boolean;
  vision?: boolean;
  pdf?: boolean;
  structured_output?: boolean;
}

function renderCaps(caps: unknown): string {
  if (!caps || typeof caps !== 'object') return '—';
  const flags = caps as CapabilityFlags;
  const on = (['text', 'vision', 'pdf', 'structured_output'] as const).filter((k) => flags[k]);
  return on.length ? on.join(' / ') : '—';
}

export default async function LlmSettingsPage() {
  const providers = await prisma.llm_provider.findMany({ orderBy: { id: 'asc' } });

  const defaults = Object.entries(DEFAULT_ENV_KEYS).map(([taskKind, envKey]) => ({
    taskKind,
    envKey,
    value: process.env[envKey] ?? '',
  }));

  return (
    <main className="p-8 max-w-5xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">LLM Provider 配置</h1>
        <p className="text-sm opacity-60 mt-1">F2.1 列表 / 启停 · F2.2 默认绑定（v0.1 env 只读）</p>
      </header>

      {/* F2.2 默认 Provider 绑定（env 只读） */}
      <section className="border rounded-lg p-4">
        <h2 className="font-medium mb-1">F2.2 默认 Provider 绑定</h2>
        <p className="text-xs opacity-70 mb-3">
          v0.1 通过 env 只读，等总控加 <code>admin_setting</code> 表后改为可写。
        </p>
        <ul className="text-sm space-y-1">
          {defaults.map((d) => (
            <li key={d.taskKind} className="flex items-baseline gap-3">
              <span className="w-40">{TASK_KIND_LABELS[d.taskKind]}</span>
              <code className="opacity-60 text-xs">{d.envKey}</code>
              <span className="ml-auto">
                {d.value ? (
                  <code className="text-xs">{d.value}</code>
                ) : (
                  <span className="text-xs text-amber-600">未配置</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* F2.1 Provider 列表 */}
      <section>
        <h2 className="font-medium mb-3">F2.1 Provider 列表</h2>
        {providers.length === 0 ? (
          <p className="text-sm opacity-60">
            llm_provider 表为空。请通过 seed / SQL 写入至少 1 条 Provider 记录。
          </p>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-black/5 dark:bg-white/5 text-left">
                <tr>
                  <th className="p-2">id</th>
                  <th className="p-2">protocol</th>
                  <th className="p-2">model</th>
                  <th className="p-2">capabilities</th>
                  <th className="p-2">enabled</th>
                  <th className="p-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-2 font-mono text-xs">{p.id}</td>
                    <td className="p-2">{p.protocol}</td>
                    <td className="p-2">{p.model}</td>
                    <td className="p-2 text-xs opacity-80">{renderCaps(p.capabilities)}</td>
                    <td className="p-2">
                      {p.enabled ? (
                        <span className="text-green-600">启用</span>
                      ) : (
                        <span className="opacity-50">停用</span>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      <form action={toggleProviderAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="next" value={String(!p.enabled)} />
                        <button
                          type="submit"
                          className="px-2 py-1 rounded border text-xs hover:bg-black/5 dark:hover:bg-white/10"
                        >
                          切换为{p.enabled ? '停用' : '启用'}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
