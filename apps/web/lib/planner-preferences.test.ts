import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PLANNER_WEIGHTS,
  buildPlannerConfig,
  buildPlannerWeightSelection,
  isPlannerWeightsEditable,
  readPlannerPreferenceFormData,
  resolvePlannerPreference,
  validatePlannerPreferenceInput,
} from './planner-preferences';

test('uses auto mode and default weights when the student has no planner preference', () => {
  assert.deepEqual(resolvePlannerPreference(null), {
    mode: 'auto',
    weights: DEFAULT_PLANNER_WEIGHTS,
    total: 100,
  });
});

test('normalizes stored planner weights and keeps missing values at defaults', () => {
  assert.deepEqual(
    resolvePlannerPreference({
      mode: 'custom',
      weights: {
        new_knowledge: 50,
        mistake_variant: 20,
        spaced_review: 30,
      },
    }),
    {
      mode: 'custom',
      weights: {
        new_knowledge: 50,
        mistake_variant: 20,
        spaced_review: 30,
        feynman_check: 0,
      },
      total: 100,
    },
  );
});

test('custom planner preference requires the four weights to total 100', () => {
  const result = validatePlannerPreferenceInput({
    mode: 'custom',
    weights: {
      new_knowledge: 40,
      mistake_variant: 30,
      spaced_review: 20,
      feynman_check: 0,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, '四项比例合计需要等于 100');
});

test('auto planner preference can retain edited weights without custom validation', () => {
  const result = validatePlannerPreferenceInput({
    mode: 'auto',
    weights: {
      new_knowledge: 80,
      mistake_variant: 0,
      spaced_review: 0,
      feynman_check: 0,
    },
  });

  assert.deepEqual(result, {
    ok: true,
    preference: {
      mode: 'auto',
      weights: {
        new_knowledge: 80,
        mistake_variant: 0,
        spaced_review: 0,
        feynman_check: 0,
      },
      total: 80,
    },
  });
});

test('builds the shared plannerConfig without exposing UI labels', () => {
  assert.deepEqual(
    buildPlannerConfig({
      mode: 'custom',
      weights: {
        new_knowledge: 25,
        mistake_variant: 25,
        spaced_review: 25,
        feynman_check: 25,
      },
      total: 100,
    }),
    {
      mode: 'custom',
      weights: {
        new_knowledge: 25,
        mistake_variant: 25,
        spaced_review: 25,
        feynman_check: 25,
      },
    },
  );
});

test('reads planner preference form data from student-facing controls', () => {
  const formData = new FormData();
  formData.set('mode', 'custom');
  formData.set('new_knowledge_enabled', 'on');
  formData.set('new_knowledge', '10');
  formData.set('mistake_variant_enabled', 'on');
  formData.set('mistake_variant', '20');
  formData.set('spaced_review_enabled', 'on');
  formData.set('spaced_review', '30');
  formData.set('feynman_check_enabled', 'on');
  formData.set('feynman_check', '40');

  assert.deepEqual(readPlannerPreferenceFormData(formData), {
    mode: 'custom',
    weights: {
      new_knowledge: '10',
      mistake_variant: '20',
      spaced_review: '30',
      feynman_check: '40',
    },
  });
});

test('sets unchecked custom planner options to zero when reading form data', () => {
  const formData = new FormData();
  formData.set('mode', 'custom');
  formData.set('new_knowledge_enabled', 'on');
  formData.set('new_knowledge', '70');
  formData.set('mistake_variant_enabled', 'on');
  formData.set('mistake_variant', '30');
  formData.set('spaced_review', '30');
  formData.set('feynman_check', '40');

  assert.deepEqual(readPlannerPreferenceFormData(formData), {
    mode: 'custom',
    weights: {
      new_knowledge: '70',
      mistake_variant: '30',
      spaced_review: 0,
      feynman_check: 0,
    },
  });
});

test('marks positive weights as selected for planner option checkboxes', () => {
  assert.deepEqual(
    buildPlannerWeightSelection({
      new_knowledge: 40,
      mistake_variant: 30,
      spaced_review: 30,
      feynman_check: 0,
    }),
    {
      new_knowledge: true,
      mistake_variant: true,
      spaced_review: true,
      feynman_check: false,
    },
  );
});

test('only custom mode allows editing planner weights', () => {
  assert.equal(isPlannerWeightsEditable('auto'), false);
  assert.equal(isPlannerWeightsEditable('custom'), true);
});
