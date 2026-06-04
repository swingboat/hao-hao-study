/**
 * F4.3 — KP 抽取 prompt 模板（PRD §3.5：prompt 由代码常量维护）。
 *
 * 版本号会落到 llm_parse_job.prompt_version，方便审计后追踪某次 staging 是哪个
 * 版本的 prompt 跑出来的——以后 prompt 调优时只增不删。
 */
import type { subject } from '@hao/db';

export const KP_PROMPT_VERSION = 'kp/2026-06-04-v1';

export function buildKpPrompt(subjectRow: subject, textbookText: string): string {
  return `你是${subjectRow.name}的资深教研专家。请从下方教材正文中抽取知识点（KP）候选清单，每个 KP 需包含：

- name: 知识点名称（2-50 字符），如"函数的单调性"、"等差数列求和公式"
- chapter_no: 教材章节编号文本（如 "§3.2"、"第二章 第3节"），无法从正文判断填 null
- brief: 50 字以内简介，仅供运营审核展示参考，不作为正式定义

要求：
1. 严格输出 JSON 对象 { items: [...] }，不要任何解释、不要 markdown 代码块标记
2. 单次最多 200 条；同一 KP 在多处出现合并为一条
3. 抽取的颗粒度应当对应"课程标准最小考点"——粗到一整章、细到一个公式都不合适，
   遵循"够独立出题、够独立测评"的颗粒度（如"指数函数图像与性质"算一个 KP，"指数函数"过粗）
4. 仅返回知识点本身；学科目标、能力要求、教学建议等非知识点内容请忽略

教材正文（学科：${subjectRow.name}，学段：${subjectRow.stage}）：
<<<
${textbookText}
>>>`;
}
