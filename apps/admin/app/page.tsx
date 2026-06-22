/**
 * 根路径 → /admin 落地页。
 * admin端整体托管在 /admin/* 命名空间下（与 PRD 保持一致），根路径仅做转发。
 */
import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/admin');
}
