export interface TextbookFilterGroup {
  canonicalId: string;
  subjectId: string | null;
  uploadIds: readonly string[];
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

export function buildTextbookSelectState<TGroup extends TextbookFilterGroup>(
  subjectId: string,
  requestedTextbookId: string,
  groups: readonly TGroup[],
) {
  const { textbooks, currentGroup } = resolveTextbookFilter(subjectId, requestedTextbookId, groups);

  return {
    textbooks,
    currentGroup,
    value: currentGroup?.canonicalId ?? '',
    disabled: !subjectId,
    placeholder: subjectId ? '— 请选择教材 —' : '— 请先选择学科 —',
  };
}
