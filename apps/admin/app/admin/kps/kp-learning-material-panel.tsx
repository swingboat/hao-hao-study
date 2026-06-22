import type { KpLearningMaterialGroup } from '../../../lib/kp-learning-materials';
import { MathText } from '../questions/import/[uploadId]/math-text';

export interface KpLearningMaterialPanelProps {
  kpName: string;
  groups: KpLearningMaterialGroup[];
}

export function KpLearningMaterialPanel({ kpName, groups }: KpLearningMaterialPanelProps) {
  return (
    <section className="border rounded-lg overflow-hidden">
      <header className="px-4 py-3 bg-black/5 dark:bg-white/5">
        <p className="text-xs opacity-60">知识点相关内容</p>
        <h2 className="font-semibold">{kpName}</h2>
      </header>

      {groups.length === 0 ? (
        <div className="p-4 text-sm opacity-70">
          该知识点下还没有已发布的学习材料。请先在学习资料导入审核页发布相关内容。
        </div>
      ) : (
        <div className="divide-y">
          {groups.map((group) => (
            <section key={group.type} className="p-4">
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <h3 className="font-medium">{group.label}</h3>
                <span className="text-xs opacity-60 tabular-nums">{group.items.length} 条</span>
              </div>
              <div className="space-y-3">
                {group.items.map((item) => (
                  <article key={item.id} className="rounded border p-3 bg-white dark:bg-neutral-950">
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="font-medium text-sm">{item.title}</h4>
                      {item.sourceLabel ? (
                        <span className="text-xs opacity-60 shrink-0">{item.sourceLabel}</span>
                      ) : null}
                    </div>
                    {item.studentSummary ? (
                      <p className="text-xs opacity-70 mt-1">{item.studentSummary}</p>
                    ) : null}
                    <MathText block text={item.content} className="text-sm leading-relaxed mt-2" />
                    {item.textSnippet ? (
                      <p className="text-xs opacity-60 mt-2 border-l pl-2">
                        原文片段：{item.textSnippet}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
