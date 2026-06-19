/**
 * QuestionParsedSchema 单测
 *
 * 覆盖：
 *   - choice happy path（含多选）
 *   - fill_in happy path（多空答案）
 *   - choice 无 options 拒收
 *   - choice 答案不在 options 里拒收
 *   - fill_in 含 options 拒收
 *   - essay 等其它 question_type 拒收（zod enum 兜底）
 *   - kp_hints 空 / 重复拒收
 *   - 字段长度边界（content / options.text / kp_hints[i]）
 *   - 批量上限 300
 */
import { describe, expect, it } from 'vitest';
import { QuestionBatchSchema, QuestionParsedSchema } from './question';

describe('QuestionParsedSchema — choice happy path', () => {
  it('单选题：A-D 选项 + 答案 A', () => {
    const r = QuestionParsedSchema.safeParse({
      content: '集合 A = {1,2,3}, B = {2,3,4}, 则 A ∩ B = ?',
      question_type: 'choice',
      options: [
        { label: 'A', text: '{2,3}' },
        { label: 'B', text: '{1,2,3,4}' },
        { label: 'C', text: '{1}' },
        { label: 'D', text: '{4}' },
      ],
      answer: 'A',
      solution_text: 'A ∩ B 取两个集合的公共元素。',
      difficulty: 2,
      kp_hints: ['集合的运算'],
      source_hint: { page: 12, question_no: '第 3 题' },
    });
    expect(r.success).toBe(true);
  });

  it('多选题：答案 AB 时两个字母都要在 options 里', () => {
    const r = QuestionParsedSchema.safeParse({
      content: '下列函数中是奇函数的是？',
      question_type: 'choice',
      options: [
        { label: 'A', text: 'f(x) = x^3' },
        { label: 'B', text: 'f(x) = sin(x)' },
        { label: 'C', text: 'f(x) = x^2' },
        { label: 'D', text: 'f(x) = e^x' },
      ],
      answer: 'AB',
      solution_text: '奇函数定义 f(-x) = -f(x)。',
      difficulty: 3,
      kp_hints: ['函数的奇偶性'],
    });
    expect(r.success).toBe(true);
  });
});

describe('QuestionParsedSchema — fill_in happy path', () => {
  it('单空填空', () => {
    const r = QuestionParsedSchema.safeParse({
      content: '函数 f(x) = 2x + 1 的反函数为 _____',
      question_type: 'fill_in',
      // options 留空
      options: [],
      answer: 'f^{-1}(x) = (x-1)/2',
      solution_text: '设 y = 2x + 1 解出 x。',
      difficulty: 2,
      kp_hints: ['反函数', '一次函数'],
    });
    expect(r.success).toBe(true);
  });

  it('多空填空：用分号分隔答案', () => {
    const r = QuestionParsedSchema.safeParse({
      content: '集合 {1,2,3} 的子集个数是 _____, 真子集个数是 _____',
      question_type: 'fill_in',
      options: [],
      answer: '8;7',
      solution_text: '2^n / 2^n - 1。',
      difficulty: 1,
      kp_hints: ['集合的子集'],
    });
    expect(r.success).toBe(true);
  });

  it('options 字段缺省也 OK（zod default=[]）', () => {
    const r = QuestionParsedSchema.safeParse({
      content: '函数 f(x) = 2x + 1 的反函数为 _____',
      question_type: 'fill_in',
      answer: 'f^{-1}(x) = (x-1)/2',
      difficulty: 2,
      kp_hints: ['反函数'],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.options).toEqual([]);
  });

  it('solution_text 缺省时 default=""', () => {
    const r = QuestionParsedSchema.safeParse({
      content: '1 + 1 = _____',
      question_type: 'fill_in',
      answer: '2',
      difficulty: 1,
      kp_hints: ['加法运算'],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.solution_text).toBe('');
  });
});

describe('QuestionParsedSchema — superRefine 拒收路径', () => {
  it('choice 只给 1 个选项 → 拒收', () => {
    const r = QuestionParsedSchema.safeParse({
      content: 'X = ?',
      question_type: 'choice',
      options: [{ label: 'A', text: '1' }],
      answer: 'A',
      difficulty: 1,
      kp_hints: ['x'],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('choice 题至少 2 个选项');
    }
  });

  it('choice 答案字母不在 options 里 → 拒收', () => {
    const r = QuestionParsedSchema.safeParse({
      content: 'X = ?',
      question_type: 'choice',
      options: [
        { label: 'A', text: '1' },
        { label: 'B', text: '2' },
      ],
      answer: 'C',
      difficulty: 1,
      kp_hints: ['x'],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('在 options 里找不到对应选项');
    }
  });

  it('choice 答案含非字母 → 拒收', () => {
    const r = QuestionParsedSchema.safeParse({
      content: 'X = ?',
      question_type: 'choice',
      options: [
        { label: 'A', text: '1' },
        { label: 'B', text: '2' },
      ],
      answer: '1', // 应为 "A" 而非 "1"
      difficulty: 1,
      kp_hints: ['x'],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('必须由大写字母组成');
    }
  });

  it('fill_in 含 options → 拒收', () => {
    const r = QuestionParsedSchema.safeParse({
      content: 'X = _____',
      question_type: 'fill_in',
      options: [{ label: 'A', text: '不该有' }],
      answer: '1',
      difficulty: 1,
      kp_hints: ['x'],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('fill_in 题不应包含 options');
    }
  });

  it('essay 等其它 question_type → 被 enum 拒收（决议 Q2=a）', () => {
    const r = QuestionParsedSchema.safeParse({
      content: '请论述...',
      question_type: 'essay',
      answer: '...',
      difficulty: 3,
      kp_hints: ['x'],
    });
    expect(r.success).toBe(false);
  });

  it('kp_hints 为空 → 拒收', () => {
    const r = QuestionParsedSchema.safeParse({
      content: 'X = _____',
      question_type: 'fill_in',
      answer: '1',
      difficulty: 1,
      kp_hints: [],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('至少要给 1 个 kp_hint');
    }
  });

  it('kp_hints 重复条目 → 拒收', () => {
    const r = QuestionParsedSchema.safeParse({
      content: 'X = _____',
      question_type: 'fill_in',
      answer: '1',
      difficulty: 1,
      kp_hints: ['集合', '集合'],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('重复条目');
    }
  });

  it('difficulty 越界（0 / 6 / 非整数）→ 拒收', () => {
    for (const d of [0, 6, 2.5]) {
      const r = QuestionParsedSchema.safeParse({
        content: 'X = _____',
        question_type: 'fill_in',
        answer: '1',
        difficulty: d,
        kp_hints: ['x'],
      });
      expect(r.success).toBe(false);
    }
  });

  it('content 过短 / 过长 → 拒收', () => {
    const short = QuestionParsedSchema.safeParse({
      content: '?',
      question_type: 'fill_in',
      answer: '1',
      difficulty: 1,
      kp_hints: ['x'],
    });
    expect(short.success).toBe(false);

    const long = QuestionParsedSchema.safeParse({
      content: 'x'.repeat(2001),
      question_type: 'fill_in',
      answer: '1',
      difficulty: 1,
      kp_hints: ['x'],
    });
    expect(long.success).toBe(false);
  });

  it('option label 必须单大写字母', () => {
    const r = QuestionParsedSchema.safeParse({
      content: 'X?',
      question_type: 'choice',
      options: [
        { label: 'a', text: '1' }, // 小写
        { label: 'B', text: '2' },
      ],
      answer: 'B',
      difficulty: 1,
      kp_hints: ['x'],
    });
    expect(r.success).toBe(false);
  });
});

describe('QuestionBatchSchema', () => {
  const validQuestion = {
    content: '集合 A = {1}, B = {2}, 则 A ∪ B = ?',
    question_type: 'fill_in' as const,
    answer: '{1,2}',
    difficulty: 1,
    kp_hints: ['集合的运算'],
  };

  it('正常批量', () => {
    const r = QuestionBatchSchema.safeParse({
      questions: [validQuestion, validQuestion],
    });
    expect(r.success).toBe(true);
  });

  it('questions 为空 → 拒收', () => {
    const r = QuestionBatchSchema.safeParse({ questions: [] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('至少应抽出 1 道题');
    }
  });

  it('questions 超过 300 → 拒收（疑似提示词失控）', () => {
    const r = QuestionBatchSchema.safeParse({
      questions: Array.from({ length: 301 }, () => validQuestion),
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('300');
    }
  });
});
