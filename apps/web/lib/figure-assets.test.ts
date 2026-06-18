import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFigureAssetRequests } from './figure-assets';

test('builds figure crop asset keys from question and figure ids', () => {
  const requests = buildFigureAssetRequests(
    new Map([
      [
        '5bf3a5f9-7729-462c-80f7-2fb3714c195d',
        {
          figures: [{ id: 'p11-fig-1', description: '集合图' }],
        },
      ],
    ]),
  );

  assert.deepEqual(requests, [
    {
      questionId: '5bf3a5f9-7729-462c-80f7-2fb3714c195d',
      figureId: 'p11-fig-1',
      assetKey: 'question-5bf3a5f9-7729-462c-80f7-2fb3714c195d-p11-fig-1.png',
    },
  ]);
});
