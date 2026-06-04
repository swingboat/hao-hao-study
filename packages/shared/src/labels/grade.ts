/**
 * 年级 / 学段展示标签字典 — admin 与 web 共用
 *
 * 设计原则：
 *   - DB / API 永远只认 enum code（g10、senior 等），从不传中文
 *   - 中文标签只在前端渲染那一刻生效，集中在本字典里
 *   - 中文用口语命名（"高一" 而非 "十年级"），跟家长 / 学生认知对齐
 *
 * 取值参考：packages/db/prisma/schema.prisma 的 enum Stage / enum Grade
 */
import type { Grade, Stage } from '@hao/db';

/** 年级中文展示名（口语） */
export const GRADE_LABEL: Record<Grade, string> = {
  g1: '一年级',
  g2: '二年级',
  g3: '三年级',
  g4: '四年级',
  g5: '五年级',
  g6: '六年级',
  g7: '初一',
  g8: '初二',
  g9: '初三',
  g10: '高一',
  g11: '高二',
  g12: '高三',
};

/** 学段中文展示名 */
export const STAGE_LABEL: Record<Stage, string> = {
  primary: '小学',
  junior: '初中',
  senior: '高中',
};

/** 年级 → 学段（派生关系）。前端常用：拿学生 grade 反推 stage 做 UI 高亮、范围筛选 */
export const GRADE_TO_STAGE: Record<Grade, Stage> = {
  g1: 'primary',
  g2: 'primary',
  g3: 'primary',
  g4: 'primary',
  g5: 'primary',
  g6: 'primary',
  g7: 'junior',
  g8: 'junior',
  g9: 'junior',
  g10: 'senior',
  g11: 'senior',
  g12: 'senior',
};

/** 按学段分组的年级（下拉框 optgroup 用） */
export const GRADES_BY_STAGE: Record<Stage, Grade[]> = {
  primary: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'],
  junior: ['g7', 'g8', 'g9'],
  senior: ['g10', 'g11', 'g12'],
};

/**
 * 年级 → 绝对学龄序号（1-12）。
 * 跨学段排序、升级流转（g10 + 1 = g11 反查）必备。
 * 直接用 enum 字符串排序（"g10" < "g2"）会出错，永远走这张表。
 */
export const GRADE_TO_NO: Record<Grade, number> = {
  g1: 1,
  g2: 2,
  g3: 3,
  g4: 4,
  g5: 5,
  g6: 6,
  g7: 7,
  g8: 8,
  g9: 9,
  g10: 10,
  g11: 11,
  g12: 12,
};

/** 反向：序号 1-12 → Grade enum */
export const NO_TO_GRADE: Record<number, Grade> = {
  1: 'g1',
  2: 'g2',
  3: 'g3',
  4: 'g4',
  5: 'g5',
  6: 'g6',
  7: 'g7',
  8: 'g8',
  9: 'g9',
  10: 'g10',
  11: 'g11',
  12: 'g12',
};

/**
 * v0.1 学生注册允许的年级（高一 / 高二 / 高三）。
 * 后端 zod schema 与前端下拉框都从这一处取，避免硬编码。
 */
export const V0_1_REGISTRATION_GRADES: readonly Grade[] = ['g10', 'g11', 'g12'] as const;

/** 升级一年（grade + 1）；高三 / 六年级 / 初三返回 null（已是学段末端） */
export function nextGrade(g: Grade): Grade | null {
  const n = GRADE_TO_NO[g];
  if (n === 6 || n === 9 || n === 12) return null;
  return NO_TO_GRADE[n + 1] ?? null;
}
