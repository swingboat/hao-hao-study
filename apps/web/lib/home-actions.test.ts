import assert from 'node:assert/strict';
import test from 'node:test';
import { HOME_ACTION_LINKS } from './home-actions.ts';

test('home action links include planner settings entry', () => {
  assert.ok(
    HOME_ACTION_LINKS.some(
      (action) => action.title === '练习设置' && action.href === '/practice-settings',
    ),
  );
});

test('home action links do not expose internal planner terms', () => {
  assert.doesNotMatch(JSON.stringify(HOME_ACTION_LINKS), /pool|planner|new_knowledge|_/);
});
