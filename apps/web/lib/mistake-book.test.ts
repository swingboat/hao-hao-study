import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMistakeQuestionPreview,
  buildMistakeQuestionSummary,
  groupMistakeBookItems,
  mistakeBookEmptyState,
} from './mistake-book.ts';

test('groups open mistakes by knowledge point without exposing internal identifiers', () => {
  const groups = groupMistakeBookItems([
    {
      questionId: 'question-1',
      knowledgePointName: '函数单调性',
      questionSummary: '判断函数在区间上的单调性',
      questionContentParts: [{ type: 'text', text: '判断函数在区间上的单调性' }],
      errorCount: 3,
      lastPracticedAt: new Date('2026-06-18T10:00:00Z'),
    },
    {
      questionId: 'question-2',
      knowledgePointName: '集合的含义',
      questionSummary: '判断元素和集合的关系',
      questionContentParts: [{ type: 'text', text: '判断元素和集合的关系' }],
      errorCount: 1,
      lastPracticedAt: new Date('2026-06-19T10:00:00Z'),
    },
    {
      questionId: 'question-3',
      knowledgePointName: '函数单调性',
      questionSummary: '比较函数值大小',
      questionContentParts: [{ type: 'text', text: '比较函数值大小' }],
      errorCount: 2,
      lastPracticedAt: new Date('2026-06-17T10:00:00Z'),
    },
  ]);

  assert.deepEqual(
    groups.map((group) => ({
      title: group.knowledgePointName,
      count: group.items.length,
      errors: group.items.map((item) => item.errorCount),
    })),
    [
      { title: '函数单调性', count: 2, errors: [3, 2] },
      { title: '集合的含义', count: 1, errors: [1] },
    ],
  );

  const visibleText = JSON.stringify(groups);
  assert.equal(visibleText.includes('kp_id'), false);
  assert.equal(visibleText.includes('question_id'), false);
});

test('builds concise student-facing mistake question summaries', () => {
  const summary = buildMistakeQuestionSummary(
    '  已知函数 f(x)=x^2，判断它在 [0,+∞) 上的单调性。'.repeat(3),
  );

  assert.ok(summary.includes('x²'));
  assert.ok(summary.endsWith('...'));
  assert.ok(summary.length <= 60);

  assert.equal(mistakeBookEmptyState, '当前没有需要回炉的错题，继续保持今天的复习节奏。');
});

test('builds mistake previews without exposing figure placeholders', () => {
  const preview = buildMistakeQuestionPreview(
    '如图，[[figure:p11-fig-1]]U是全集，M、N是U的两个子集，则阴影部分表示为( ).',
    [
      {
        id: 'p11-fig-1',
        description: '韦恩图中集合 N 不属于集合 M 的阴影部分。',
        imageUrl: '/storage/derived/source/figure-crop-v1/question-1-p11-fig-1.png',
      },
    ],
  );

  assert.equal(preview.questionSummary.includes('[[figure'), false);
  assert.ok(preview.questionSummary.includes('题图：韦恩图'));
  assert.deepEqual(preview.contentParts, [
    { type: 'text', text: '如图，' },
    {
      type: 'figure',
      id: 'p11-fig-1',
      description: '韦恩图中集合 N 不属于集合 M 的阴影部分。',
      imageUrl: '/storage/derived/source/figure-crop-v1/question-1-p11-fig-1.png',
    },
    { type: 'text', text: 'U是全集，M、N是U的两个子集，则阴影部分表示为( ).' },
  ]);
});
