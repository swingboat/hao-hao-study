import { describe, expect, it } from 'vitest';

import {
  LLM_VERSION,
  analyzeKnowledgePoints,
  analyzeQuestions,
  formatDisplayText,
  formatExamText,
  formatQuestionText,
} from '@hao/llm';

describe('@hao/llm package root', () => {
  it('exports adapter APIs, version, and display formatters', () => {
    expect(LLM_VERSION).toBe('0.1.0');
    expect(typeof analyzeKnowledgePoints).toBe('function');
    expect(typeof analyzeQuestions).toBe('function');
    expect(formatDisplayText('$A=\\{m+2, 2m^2+m\\}$')).toBe('A=m+2, 2m²+m');
    expect(formatQuestionText('若 $3 \\in A$')).toBe('若 3 ∈ A');
    expect(formatExamText('\\frac{1}{2}')).toBe('1/2');
  });
});
