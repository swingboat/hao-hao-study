import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKpSelectionHref } from './kp-page-links.ts';

test('buildKpSelectionHref keeps filters and scrolls to the material panel', () => {
  assert.equal(
    buildKpSelectionHref({
      textbook: 'upload-1',
      subject: 'math_senior',
      view: 'list',
      kpId: 'kp-1',
    }),
    '/admin/kps?textbook=upload-1&subject=math_senior&view=list&kp=kp-1#kp-materials',
  );
});

test('buildKpSelectionHref omits default tree view from the URL', () => {
  assert.equal(
    buildKpSelectionHref({
      textbook: 'upload-1',
      subject: 'math_senior',
      view: 'tree',
      kpId: 'kp-1',
    }),
    '/admin/kps?textbook=upload-1&subject=math_senior&kp=kp-1#kp-materials',
  );
});
