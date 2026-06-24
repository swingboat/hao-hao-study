export interface HomeActionLink {
  href: string;
  title: string;
  description: string;
}

export const HOME_ACTION_LINKS: HomeActionLink[] = [
  {
    href: '/progress',
    title: '学习进度',
    description: '按章节查看已掌握和需要加强的知识点。',
  },
  {
    href: '/study/history',
    title: '练习记录',
    description: '回看最近完成的练习和正确率。',
  },
  {
    href: '/study/mistakes',
    title: '错题复习',
    description: '集中处理还没彻底攻克的题。',
  },
  {
    href: '/practice-settings',
    title: '练习设置',
    description: '调整今日练习中各类题目的安排比例。',
  },
];
