import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuestionContentParts } from './question-content.ts';

test('turns figure placeholders into student-readable figure parts', () => {
  const parts = buildQuestionContentParts(
    '如图，[[figure:p11-fig-1]]$U$是全集，则阴影部分表示为(    ).',
    [
      {
        id: 'p11-fig-1',
        description:
          '韦恩图，全集 U 内有两个相交的集合 M 和 N，阴影部分为集合 N 中不属于集合 M 的部分。',
      },
    ],
  );

  assert.deepEqual(parts, [
    { type: 'text', text: '如图，' },
    {
      type: 'figure',
      id: 'p11-fig-1',
      description:
        '韦恩图，全集 U 内有两个相交的集合 M 和 N，阴影部分为集合 N 中不属于集合 M 的部分。',
    },
    { type: 'text', text: 'U是全集，则阴影部分表示为( ).' },
  ]);
});

test('does not expose unknown figure tokens to students', () => {
  const parts = buildQuestionContentParts('观察[[figure:p1-fig-9]]后作答。', []);

  assert.deepEqual(parts, [
    { type: 'text', text: '观察' },
    { type: 'figure', id: 'p1-fig-9', description: '题图暂时不可见，请先跳过这题。' },
    { type: 'text', text: '后作答。' },
  ]);
});
