import assert from 'node:assert/strict';
import test from 'node:test';
import { questionToStagingPayload } from './education-analysis-adapter.ts';

test('questionToStagingPayload renders structured sub-questions instead of object placeholders', () => {
  const payload = questionToStagingPayload(
    {
      stem: '设实数集 $S$ 是满足下面两个条件的集合。',
      type: '填空题',
      number: '补充',
      source_pages: [7],
      sub_questions: [
        {
          stem: '求证：若 $a \\in S$，则 $1-\\frac{1}{a}\\in S$.',
          answer: '',
          number: '(1)',
          analysis: '由已知递推可得。',
        },
        {
          stem: '若 $2 \\in S$，则在 $S$ 中必含有其他两个数，试求出这两个数.',
          answer: '$-1$ 和 $\\frac{1}{2}$',
          number: '(2)',
          analysis: '代入递推式。',
        },
        {
          stem: '集合 $S$ 能否是单元素集？',
          answer: '不能',
          number: '(3)',
          analysis: '三种元素互不相等。',
        },
      ],
      related_knowledge_points: [{ id: 'kp-1', name: '集合与元素的概念及特性' }],
    },
    'math_senior',
  );

  assert.equal(
    payload.content,
    [
      '设实数集 $S$ 是满足下面两个条件的集合。',
      '1. 求证：若 $a \\in S$，则 $1-\\frac{1}{a}\\in S$.',
      '2. 若 $2 \\in S$，则在 $S$ 中必含有其他两个数，试求出这两个数.',
      '3. 集合 $S$ 能否是单元素集？',
    ].join('\n'),
  );
  assert.ok(!String(payload.content).includes('[object Object]'));
  assert.equal(payload.answer, '2. $-1$ 和 $\\frac{1}{2}$\n3. 不能');
  assert.equal(
    payload.solution_text,
    '1. 由已知递推可得。\n2. 代入递推式。\n3. 三种元素互不相等。',
  );
});

test('questionToStagingPayload normalizes nested option and answer values', () => {
  const payload = questionToStagingPayload(
    {
      stem: { text: '下列命题正确的是' },
      type: 'choice',
      options: [
        { label: 'A', value: { text: '$A \\subseteq B$' } },
        { key: 'B', content: { stem: '$B \\subseteq A$' } },
      ],
      answer: { text: 'A' },
      related_knowledge_points: [{ name: { text: '子集与真子集' } }],
    },
    'math_senior',
  );

  assert.equal(payload.content, '下列命题正确的是');
  assert.deepEqual(payload.options, [
    { label: 'A', text: '$A \\subseteq B$' },
    { label: 'B', text: '$B \\subseteq A$' },
  ]);
  assert.equal(payload.answer, 'A');
  assert.deepEqual(payload.kp_hints, ['子集与真子集']);
});
