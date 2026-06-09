import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '好好学习 · 运营端',
  description: '运营端管理后台 — 好好学习 v0.1 MVP',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning：豁免 <html> 属性差异。Immersive Translate / Dark Reader
    // 等浏览器扩展会在 React hydrate 前往 <html> 加 data-* / class 属性（如
    // data-immersive-translate-page-theme），触发 hydration mismatch warning。
    // 该属性只作用于本元素自身属性，子树仍会正常比对，不会掩盖真实 bug。
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
