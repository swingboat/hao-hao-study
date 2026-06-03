import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '好好学习',
  description: '智能学习助手 — 好好学习 v0.1 MVP',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
