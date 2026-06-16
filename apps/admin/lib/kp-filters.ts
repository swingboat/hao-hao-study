export interface TextbookFilterGroup {
  canonicalId: string;
  subjectId: string | null;
  uploadIds: string[];
}

export function resolveTextbookFilter<TGroup extends TextbookFilterGroup>(
  subjectId: string,
  requestedTextbookId: string,
  groups: readonly TGroup[],
) {
  if (!subjectId) {
    return { textbooks: [], currentGroup: undefined };
  }

  const textbooks = groups.filter((group) => group.subjectId === subjectId);
  const currentGroup = requestedTextbookId
    ? textbooks.find((group) => group.uploadIds.includes(requestedTextbookId))
    : undefined;

  return { textbooks, currentGroup };
}
