const STAGE_ORDER: Record<string, number> = {
  primary: 0,
  junior: 1,
  senior: 2,
};

interface SubjectLike {
  id: string;
  name: string;
  stage?: string | null;
}

function stageRank(stage: string | null | undefined): number {
  return stage ? (STAGE_ORDER[stage] ?? 99) : 99;
}

export function sortSubjectsByStage<T extends SubjectLike>(subjects: readonly T[]): T[] {
  return [...subjects].sort((a, b) => {
    const byStage = stageRank(a.stage) - stageRank(b.stage);
    if (byStage !== 0) return byStage;

    const byName = a.name.localeCompare(b.name, 'zh-CN');
    if (byName !== 0) return byName;

    return a.id.localeCompare(b.id);
  });
}
