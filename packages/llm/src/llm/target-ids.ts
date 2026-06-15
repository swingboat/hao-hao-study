// @ts-nocheck
export function buildLlmTargetIdMap(llmTargets = []) {
  const idMap = new Map();

  for (const llmTarget of llmTargets) {
    idMap.set(llmTarget.id, llmTarget.id);
    for (const alias of llmTarget.aliases ?? []) {
      idMap.set(alias, llmTarget.id);
    }
  }

  return idMap;
}

export function canonicalLlmTargetIdFor(llmTargets, llmTargetId) {
  return buildLlmTargetIdMap(llmTargets).get(llmTargetId) ?? llmTargetId;
}

export function findLlmTargetByIdOrAlias(llmTargets, llmTargetId) {
  const canonicalId = canonicalLlmTargetIdFor(llmTargets, llmTargetId);
  return llmTargets.find((llmTarget) => llmTarget.id === canonicalId) ?? null;
}

export const buildTargetIdMap = buildLlmTargetIdMap;
export const canonicalTargetIdFor = canonicalLlmTargetIdFor;
export const findTargetByIdOrAlias = findLlmTargetByIdOrAlias;
