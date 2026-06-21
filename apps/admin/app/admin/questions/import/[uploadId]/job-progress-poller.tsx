/**
 * F3 staging 页轮询组件 — 当 job.status ∈ {queued, running} 时挂载。
 * 与 /admin/kps/import/[uploadId]/job-progress-poller.tsx 同形，但读 QuestionProgressSnapshot。
 */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { JobProgressView } from './actions';
import { getJobProgressAction } from './actions';

const POLL_INTERVAL_MS = 2000;

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}min ${r}s`;
}

function phaseLabel(p: JobProgressView['progress']): string {
  if (!p) return '等待启动…';
  switch (p.phase) {
    case 'preparing':
      return '① 准备解析任务';
    case 'rendering':
      return '② 文档页面处理中';
    case 'analyzing':
      return `③ 学习资料解析中（${p.pagesDone}/${p.pageCount ?? '?'} 页）`;
    case 'synthesizing':
      return '④ 汇总学习资料结果';
    case 'persisting':
      return '⑤ 写 staging 中…';
    case 'done':
      return `完成（已提取 ${p.questionCount ?? '?'} 道题）`;
    case 'failed':
      return '❌ 解析失败';
    default:
      return p.phase;
  }
}

function pctOf(p: JobProgressView['progress']): number {
  if (!p) return 0;
  if (p.phase === 'done') return 100;
  if (p.phase === 'failed') return 0;
  if (p.phase === 'preparing') return 5;
  if (p.phase === 'rendering') return 15;
  if (p.phase === 'analyzing' && p.pageCount) {
    return Math.min(75, 10 + Math.round((p.pagesDone / p.pageCount) * 65));
  }
  if (p.phase === 'synthesizing') return 90;
  if (p.phase === 'persisting') return 95;
  return 0;
}

export interface JobProgressPollerProps {
  jobId: string;
  initialStatus: 'queued' | 'running' | 'succeeded' | 'failed';
}

export function JobProgressPoller({ jobId, initialStatus }: JobProgressPollerProps) {
  const router = useRouter();
  const [view, setView] = useState<JobProgressView | null>(null);
  const [tickedAt, setTickedAt] = useState(Date.now());
  const [pollError, setPollError] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (stoppedRef.current) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const v = await getJobProgressAction(jobId);
        if (cancelled) return;
        setView(v);
        setTickedAt(Date.now());
        setPollError(null);
        if (v.status === 'succeeded' || v.status === 'failed') {
          stoppedRef.current = true;
          router.refresh();
        }
      } catch (e) {
        if (cancelled) return;
        setPollError(e instanceof Error ? e.message : String(e));
      }
    };
    tick();
    const iv = setInterval(() => {
      if (stoppedRef.current) {
        clearInterval(iv);
        return;
      }
      tick();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [jobId, router]);

  if (!view) {
    return (
      <section className="border-2 border-blue-400 rounded-lg p-4 bg-blue-50/40 dark:bg-blue-950/30">
        <p className="text-sm flex items-center gap-2">
          <Spinner /> 解析任务状态加载中（{statusLabel(initialStatus)}）…
        </p>
      </section>
    );
  }

  const p = view.progress;
  const startedAtMs = p ? new Date(p.startedAt).getTime() : Date.now();
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const pct = pctOf(p);

  const STALE_THRESHOLD_MS = 3 * 60 * 1000;
  const staleWarning = (() => {
    if (!p) return null;
    const lastAt = new Date(p.lastEventAt).getTime();
    if (!Number.isFinite(lastAt)) return null;
    const idleMs = Date.now() - lastAt;
    if (idleMs < STALE_THRESHOLD_MS) return null;
    return `任务 ${formatDuration(idleMs)} 无进度更新，后台 runQuestionParse 可能已中断（server 重启 / 进程崩溃）`;
  })();

  return (
    <section
      className="border-2 border-blue-500 rounded-lg p-4 bg-blue-50/60 dark:bg-blue-950/30 space-y-3"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <Spinner />
        <div className="flex-1">
          <p className="font-medium text-sm">{phaseLabel(p)}</p>
          <p className="text-xs opacity-70 mt-0.5">{p?.lastEvent ?? '...'}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg tabular-nums">{formatDuration(elapsedMs)}</p>
          <p className="text-[10px] opacity-60">已用时</p>
        </div>
      </div>

      <div className="h-2 bg-blue-200/60 dark:bg-blue-900/50 rounded overflow-hidden">
        <div
          className="h-full bg-blue-600 transition-all duration-500 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <Metric label="状态" value={statusLabel(view.status)} />
        <Metric
          label="页数"
          value={
            p
              ? `${p.pagesDone}/${p.pageCount ?? '?'}${p.pagesFailed ? ` (fail ${p.pagesFailed})` : ''}`
              : '—'
          }
          mono
        />
        <Metric
          label="累计 tokens"
          value={
            view.tokenUsage
              ? `${view.tokenUsage.input}+${view.tokenUsage.output}=${view.tokenUsage.total}`
              : '—'
          }
          mono
        />
        <Metric
          label="已提取题目"
          value={p?.questionCount != null ? String(p.questionCount) : '—'}
          mono
        />
      </div>

      <p className="text-[10px] opacity-50">
        快照时间 {new Date(tickedAt).toLocaleTimeString('zh-CN')} · 每 {POLL_INTERVAL_MS / 1000}s
        轮询；离开页面也不会中断后台解析。
        {pollError ? <span className="text-red-600 ml-2">轮询失败：{pollError}</span> : null}
      </p>
      {staleWarning ? (
        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-950/30 border border-amber-400 rounded p-2 mt-1">
          ⚠️ {staleWarning}
        </p>
      ) : null}
    </section>
  );
}

function statusLabel(status: JobProgressPollerProps['initialStatus']): string {
  return (
    {
      queued: '排队中',
      running: '学习资料解析中',
      succeeded: '解析完成',
      failed: '解析失败',
    }[status] ?? status
  );
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="opacity-60 text-[10px] uppercase tracking-wider">{label}</p>
      <p className={mono ? 'font-mono tabular-nums' : ''}>{value}</p>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-5 w-5 text-blue-600"
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="解析中"
    >
      <title>解析中</title>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}
