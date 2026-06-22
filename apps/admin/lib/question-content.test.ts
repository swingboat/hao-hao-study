import assert from 'node:assert/strict';
import test from 'node:test';
import { stripDuplicatedChoiceOptionsFromContent } from './question-content.ts';

test('stripDuplicatedChoiceOptionsFromContent removes trailing options duplicated in structured options', () => {
  const content = [
    '已知集合 $A = \\{-1, a^2 - 2a + 1, a - 4\\}$，若 $4 \\in A$，则 $a$ 的值可能为（ ）',
    'A. -1, 3',
    'B. -1',
    'C. -1, 3, 8',
    'D. -1, 8',
  ].join('\n');

  assert.equal(
    stripDuplicatedChoiceOptionsFromContent(content, [
      { label: 'A', text: '-1, 3' },
      { label: 'B', text: '-1' },
      { label: 'C', text: '-1, 3, 8' },
      { label: 'D', text: '-1, 8' },
    ]),
    '已知集合 $A = \\{-1, a^2 - 2a + 1, a - 4\\}$，若 $4 \\in A$，则 $a$ 的值可能为（ ）',
  );
});

test('stripDuplicatedChoiceOptionsFromContent keeps content when option suffix does not match structured options', () => {
  const content = ['判断下列说法是否正确。', 'A. 这是题干说明，不是选项'].join('\n');

  assert.equal(
    stripDuplicatedChoiceOptionsFromContent(content, [
      { label: 'A', text: '正确' },
      { label: 'B', text: '错误' },
    ]),
    content,
  );
});
