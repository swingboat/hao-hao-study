import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQuestionContentParts, stripEmbeddedChoiceOptions } from './question-content.ts';

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

test('strips embedded choice option lines when structured options are available', () => {
  const content = [
    '(2024·向量) 设a,b为向量，则“(a+b)·(a-b)=0”是“|a|=|b|”的（ ）',
    'A. 充分不必要条件',
    'B. 必要不充分条件',
    'C. 充要条件',
    'D. 既不充分也不必要条件',
  ].join('\n');

  assert.equal(
    stripEmbeddedChoiceOptions(content, [
      { label: 'A', text: '充分不必要条件' },
      { label: 'B', text: '必要不充分条件' },
      { label: 'C', text: '充要条件' },
      { label: 'D', text: '既不充分也不必要条件' },
    ]),
    '(2024·向量) 设a,b为向量，则“(a+b)·(a-b)=0”是“|a|=|b|”的（ ）',
  );
});

test('does not strip stem text unless a complete trailing option block exists', () => {
  const content = '若命题 A 能推出命题 B，则判断 A 与 B 的关系。';

  assert.equal(
    stripEmbeddedChoiceOptions(content, [
      { label: 'A', text: '充分条件' },
      { label: 'B', text: '必要条件' },
    ]),
    content,
  );
});

test('removes object placeholder lines from imported question content', () => {
  const parts = buildQuestionContentParts(
    [
      '（1）若集合 A = x | ax² + (a-6)x + 2 = 0，x ∈ R 是单元素集合，则实数 a = ____',
      '（2）已知集合 x | (x-2)(x² - 2x + a) = 0 中的所有元素之和为 2，则实数 a 的取值集合为 ____。',
      '1. [object Object]',
      '2. [object Object]',
    ].join('\n'),
  );

  assert.deepEqual(parts, [
    {
      type: 'text',
      text: '（1）若集合 A = x | ax² + (a-6)x + 2 = 0，x ∈ R 是单元素集合，则实数 a = ____\n（2）已知集合 x | (x-2)(x² - 2x + a) = 0 中的所有元素之和为 2，则实数 a 的取值集合为 ____。',
    },
  ]);
});
