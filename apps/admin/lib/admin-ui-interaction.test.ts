import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const globalsCss = () => readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('admin global styles provide visible button hover and focus feedback', () => {
  const css = globalsCss();

  assert.match(css, /button:not\(:disabled\):hover/);
  assert.match(css, /transform:\s*translateY\(-1px\)/);
  assert.match(css, /box-shadow:/);
  assert.match(css, /button:focus-visible/);
  assert.match(css, /button:disabled/);
});
