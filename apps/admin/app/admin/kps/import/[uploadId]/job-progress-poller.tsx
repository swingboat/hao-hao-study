/**
 * F4.3 staging 页轮询组件 — 当 job.status ∈ {queued, running} 时挂载。
 *
 * 行为：
 *   - 每 2s 调 getJobProgressAction(jobId) 拉最新快照
 *   - 显示当前阶段（planning / chunking #N/total / sleeping / final）、累计 token、ETA
 *   - 进入终态（succeeded / failed）→ stop poll + router.refresh() 让 page.tsx 重渲染
 *     渲染完成后整页结构会变（出现 staging 列表），这个 poller 也会从 DOM 中消失
 *
 * 设计取舍：
 *   - 用 server action 而非 /api 路由，省一个文件，鉴权也复用 admin session
 *   - 轮询 interval 2s：vision chunk 通常几十秒级，2s 粒度对 UI 完全够用，且每次只读
 *     1 行 job + 1 个 count，对 DB 几乎无压
 *   - 进入终态后不会立刻有新 staging 行（事务里一起写的），所以 router.refresh 是必须的
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
    case 'planning':
      return '① 页面渲染与切片规划中';
    case 'chunking':
      return p.currentChunk
        ? `② 正在解析 chunk #${p.currentChunk.index}/${p.totalChunks ?? '?'}（页 ${p.currentChunk.startPage}-${p.currentChunk.endPage}${(p.chunksReused ?? 0) > 0 ? `；已复用 ${p.chunksReused} 片` : ''}）`
        : `② chunk ${p.chunksDone}/${p.totalChunks ?? '?'} 已完成${(p.chunksReused ?? 0) > 0 ? `（含 ${p.chunksReused} 片复用）` : ''}`;
    case 'sleeping':
      return `⏸ rate-limit sleep（${p.chunksDone}/${p.totalChunks ?? '?'} chunks done）`;
    case 'merging':
      return '③ 合并去重中（TS 手工合并，无 LLM 终审）';
    case 'done':
      return '④ 写 staging 中…';
    case 'failed':
      return '❌ 解析失败';
    default:
      return p.phase;
  }
}

function pctOf(p: JobProgressView['progress']): number {
  if (!p || !p.totalChunks) return 0;
  // chunk 实际推进 = 本轮跑的 + 复用的；占 90%，merge 占最后 10%
  const advanced = p.chunksDone + (p.chunksReused ?? 0);
  const chunkPct = (advanced / p.totalChunks) * 90;
  const finalBoost = p.phase === 'merging' ? 5 : p.phase === 'done' ? 10 : 0;
  return Math.min(99, Math.round(chunkPct + finalBoost));
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
          // 让 page.tsx 重新 fetch（staging 列表 + lastJob 状态会更新；poller 也会从 DOM 中消失）
          router.refresh();
        }
      } catch (e) {
        if (cancelled) return;
        setPollError(e instanceof Error ? e.message : String(e));
      }
    };
    tick(); // 立刻拉一次
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

  // 第一次 tick 前显示一个占位
  if (!view) {
    return (
      <section className="border-2 border-blue-400 rounded-lg p-4 bg-blue-50/40 dark:bg-blue-950/30">
        <p className="text-sm flex items-center gap-2">
          <Spinner /> 解析任务 <code className="text-xs">{jobId.slice(0, 8)}</code> 状态加载中（初始
          status: {initialStatus}）…
        </p>
      </section>
    );
  }

  const p = view.progress;
  const startedAtMs = p ? new Date(p.startedAt).getTime() : Date.now();
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const pct = pctOf(p);

  // Stale 检测：progress.lastEventAt 超过 STALE_THRESHOLD_MS 没更新 → 提示用户。
  // 触发条件：runParse 后台 promise 死了（dev server 重启 / OOM / 容器轮转），
  // job 在 DB 仍是 running 但没人推进它，poller 一直读到同一个 snapshot。
  // 阈值放 3 分钟：正常 vision chunk 应在该窗口内推进。
  const STALE_THRESHOLD_MS = 3 * 60 * 1000;
  const staleWarning = (() => {
    if (!p) return null;
    const lastAt = new Date(p.lastEventAt).getTime();
    if (!Number.isFinite(lastAt)) return null;
    const idleMs = Date.now() - lastAt;
    if (idleMs < STALE_THRESHOLD_MS) return null;
    return `任务 ${formatDuration(idleMs)} 无进度更新，后台 runParse 可能已中断（server 重启 / 进程崩溃）`;
  })();

  // ETA：剩余 fresh chunk × 平均耗时 + 合并 5s；复用片不耗时
  const eta = (() => {
    if (!p || !p.totalChunks || !p.avgChunkLatencyMs) return null;
    const advanced = p.chunksDone + (p.chunksReused ?? 0);
    const remaining = Math.max(0, p.totalChunks - advanced);
    if (remaining === 0 && p.phase !== 'merging') return 5_000;
    return remaining * p.avgChunkLatencyMs + 5_000;
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
        <Metric label="status" value={view.status} mono />
        <Metric
          label="chunks"
          value={(() => {
            if (!p) return '—';
            const total = p.totalChunks ?? '?';
            const reused = p.chunksReused ?? 0;
            // 显示 fresh + reused / total，让用户一眼看清复用了多少
            return reused > 0
              ? `${p.chunksDone}+${reused}=${p.chunksDone + reused}/${total}`
              : `${p.chunksDone}/${total}`;
          })()}
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
        <Metric label="ETA" value={eta != null ? `~${formatDuration(eta)}` : '—'} mono />
      </div>

      <p className="text-[10px] opacity-50">
        快照时间 {new Date(tickedAt).toLocaleTimeString('zh-CN')} · 每 {POLL_INTERVAL_MS / 1000}s
        轮询一次；离开页面也不会中断后台解析。
        {pollError ? <span className="text-red-600 ml-2">轮询失败：{pollError}</span> : null}
      </p>
      {staleWarning ? (
        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-950/30 border border-amber-400 rounded p-2 mt-1">
          ⚠️ {staleWarning} — 已落盘的 chunk 缓存保留，重新解析会跳过它们。
        </p>
      ) : null}
    </section>
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
