'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  PLANNER_WEIGHT_OPTIONS,
  type PlannerPreferenceView,
  type PlannerWeightKey,
  type PlannerWeightSelection,
  type PlannerWeights,
  buildPlannerWeightSelection,
  isPlannerWeightsEditable,
} from '../lib/planner-preferences';
import { type PlannerPreferenceFormState, savePlannerPreferenceAction } from './actions';

interface PlannerSettingsFormProps {
  preference: PlannerPreferenceView;
}

const INITIAL_STATE: PlannerPreferenceFormState = {
  status: 'idle',
  message: null,
};

export function PlannerSettingsForm({ preference }: PlannerSettingsFormProps) {
  const [state, formAction] = useActionState(savePlannerPreferenceAction, INITIAL_STATE);
  const [mode, setMode] = useState(preference.mode);
  const [weights, setWeights] = useState<PlannerWeights>(preference.weights);
  const [selectedWeights, setSelectedWeights] = useState<PlannerWeightSelection>(
    buildPlannerWeightSelection(preference.weights),
  );
  const total = useMemo(
    () =>
      PLANNER_WEIGHT_OPTIONS.reduce(
        (sum, option) => sum + (selectedWeights[option.key] ? weights[option.key] : 0),
        0,
      ),
    [selectedWeights, weights],
  );
  const weightsEditable = isPlannerWeightsEditable(mode);

  return (
    <form action={formAction} className="planner-settings-form">
      <div className="segmented-control" aria-label="练习安排方式">
        <label>
          <input
            checked={mode === 'auto'}
            name="mode"
            onChange={() => setMode('auto')}
            type="radio"
            value="auto"
          />
          <span>自动安排</span>
        </label>
        <label>
          <input
            checked={mode === 'custom'}
            name="mode"
            onChange={() => setMode('custom')}
            type="radio"
            value="custom"
          />
          <span>自定义比例</span>
        </label>
      </div>

      {!weightsEditable
        ? PLANNER_WEIGHT_OPTIONS.map((option) => (
            <input key={option.key} name={option.key} type="hidden" value={weights[option.key]} />
          ))
        : null}

      <fieldset
        aria-disabled={!weightsEditable}
        className="planner-weight-grid"
        disabled={!weightsEditable}
      >
        {PLANNER_WEIGHT_OPTIONS.map((option) => (
          <div
            className="planner-weight-field"
            data-selected={selectedWeights[option.key]}
            key={option.key}
          >
            <label className="planner-weight-toggle">
              <input
                checked={selectedWeights[option.key]}
                name={`${option.key}_enabled`}
                onChange={(event) =>
                  updateSelectedWeight(
                    setSelectedWeights,
                    setWeights,
                    option.key,
                    event.target.checked,
                  )
                }
                type="checkbox"
              />
              <span>{option.label}</span>
            </label>
            <div className="planner-number-control">
              <input
                disabled={!selectedWeights[option.key]}
                inputMode="numeric"
                max={100}
                min={0}
                name={option.key}
                onChange={(event) => updateWeight(setWeights, option.key, event.target.value)}
                step={5}
                type="number"
                value={weights[option.key]}
              />
              <span aria-hidden="true">%</span>
            </div>
          </div>
        ))}
      </fieldset>

      <div className="planner-settings-footer">
        <span
          className={mode === 'custom' && total !== 100 ? 'planner-total invalid' : 'planner-total'}
        >
          合计 {total}%
        </span>
        <SubmitButton />
      </div>

      {state.message ? (
        <p className={state.status === 'error' ? 'form-error' : 'form-success'}>{state.message}</p>
      ) : null}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="secondary-button" disabled={pending} type="submit">
      {pending ? '保存中' : '保存设置'}
    </button>
  );
}

function updateWeight(
  setWeights: Dispatch<SetStateAction<PlannerWeights>>,
  key: PlannerWeightKey,
  value: string,
) {
  const nextValue = Math.max(0, Math.min(100, Number.parseInt(value || '0', 10) || 0));
  setWeights((current) => ({
    ...current,
    [key]: nextValue,
  }));
}

function updateSelectedWeight(
  setSelectedWeights: Dispatch<SetStateAction<PlannerWeightSelection>>,
  setWeights: Dispatch<SetStateAction<PlannerWeights>>,
  key: PlannerWeightKey,
  checked: boolean,
) {
  setSelectedWeights((current) => ({
    ...current,
    [key]: checked,
  }));

  if (!checked) {
    setWeights((current) => ({
      ...current,
      [key]: 0,
    }));
  }
}
