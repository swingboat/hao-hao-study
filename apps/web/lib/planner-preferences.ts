import type { PlannerConfig, PlannerConfigMode, PlannerConfigWeightKey } from '@hao/shared';

export type PlannerWeightKey = PlannerConfigWeightKey;

export interface PlannerWeights extends Record<PlannerWeightKey, number> {}

export interface PlannerWeightSelection extends Record<PlannerWeightKey, boolean> {}

export interface PlannerPreferenceView {
  mode: PlannerConfigMode;
  weights: PlannerWeights;
  total: number;
}

export interface PlannerPreferenceInput {
  mode: unknown;
  weights: Partial<Record<PlannerWeightKey, unknown>>;
}

export type PlannerPreferenceValidationResult =
  | {
      ok: true;
      preference: PlannerPreferenceView;
    }
  | {
      ok: false;
      message: string;
      preference: PlannerPreferenceView;
    };

export const DEFAULT_PLANNER_WEIGHTS: PlannerWeights = {
  new_knowledge: 40,
  mistake_variant: 30,
  spaced_review: 30,
  feynman_check: 0,
};

export const PLANNER_WEIGHT_OPTIONS: Array<{
  key: PlannerWeightKey;
  label: string;
}> = [
  { key: 'new_knowledge', label: '新知识练习' },
  { key: 'mistake_variant', label: '错题巩固' },
  { key: 'spaced_review', label: '复习回顾' },
  { key: 'feynman_check', label: '复述检查' },
];

export function resolvePlannerPreference(
  row: { mode?: unknown; weights?: unknown } | null,
): PlannerPreferenceView {
  const mode = row?.mode === 'custom' ? 'custom' : 'auto';
  const weights = normalizePlannerWeights(row?.weights);

  return {
    mode,
    weights,
    total: totalPlannerWeight(weights),
  };
}

export function validatePlannerPreferenceInput(
  input: PlannerPreferenceInput,
): PlannerPreferenceValidationResult {
  const preference = resolvePlannerPreference({
    mode: input.mode,
    weights: input.weights,
  });

  if (preference.mode === 'custom' && preference.total !== 100) {
    return {
      ok: false,
      message: '四项比例合计需要等于 100',
      preference,
    };
  }

  return { ok: true, preference };
}

export function buildPlannerConfig(preference: PlannerPreferenceView): PlannerConfig {
  return {
    mode: preference.mode,
    weights: { ...preference.weights },
  };
}

export function isPlannerWeightsEditable(mode: PlannerConfigMode): boolean {
  return mode === 'custom';
}

export function buildPlannerWeightSelection(weights: PlannerWeights): PlannerWeightSelection {
  return {
    new_knowledge: weights.new_knowledge > 0,
    mistake_variant: weights.mistake_variant > 0,
    spaced_review: weights.spaced_review > 0,
    feynman_check: weights.feynman_check > 0,
  };
}

export function totalPlannerWeight(weights: PlannerWeights): number {
  return PLANNER_WEIGHT_OPTIONS.reduce((sum, option) => sum + weights[option.key], 0);
}

export function readPlannerPreferenceFormData(formData: FormData): PlannerPreferenceInput {
  const mode = formData.get('mode');
  const isCustom = mode === 'custom';

  return {
    mode,
    weights: Object.fromEntries(
      PLANNER_WEIGHT_OPTIONS.map((option) => [
        option.key,
        isCustom && formData.get(`${option.key}_enabled`) !== 'on' ? 0 : formData.get(option.key),
      ]),
    ),
  };
}

function normalizePlannerWeights(value: unknown): PlannerWeights {
  const source = value && typeof value === 'object' ? value : {};

  return {
    new_knowledge: normalizeWeightValue(
      (source as Partial<Record<PlannerWeightKey, unknown>>).new_knowledge,
      DEFAULT_PLANNER_WEIGHTS.new_knowledge,
    ),
    mistake_variant: normalizeWeightValue(
      (source as Partial<Record<PlannerWeightKey, unknown>>).mistake_variant,
      DEFAULT_PLANNER_WEIGHTS.mistake_variant,
    ),
    spaced_review: normalizeWeightValue(
      (source as Partial<Record<PlannerWeightKey, unknown>>).spaced_review,
      DEFAULT_PLANNER_WEIGHTS.spaced_review,
    ),
    feynman_check: normalizeWeightValue(
      (source as Partial<Record<PlannerWeightKey, unknown>>).feynman_check,
      DEFAULT_PLANNER_WEIGHTS.feynman_check,
    ),
  };
}

function normalizeWeightValue(value: unknown, fallback: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.min(100, Math.trunc(numberValue)));
}
