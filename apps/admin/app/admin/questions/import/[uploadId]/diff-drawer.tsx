/**
 * F3.4 单题 diff 抽屉 + F3.5 KP 候选映射 + F3.6 单条重跑入口。
 *
 * 布局：右侧抽屉
 *   - 左栏：LLM 原始抽取（content / answer / options / kp_hints / 图）只读展示
 *   - 右栏：可编辑表单（content / question_type / options JSON / answer / solution_text /
 *           difficulty / kp_ids[]（带搜索） / primary_kp_id）
 *   - 底部：接受并发布 / 丢弃 / 换模型重跑（F3.6）
 *
 * KP 映射 (F3.5)：
 *   - 输入框 + 实时调 searchKpsAction（300ms debounce）拉同学科候选
 *   - 选中 KP 进入下方"已选 KP"标签列表；点 ⭐ 设为 primary
 *   - "+ 新建 KP" v0.1 暂不在抽屉里做（避免事务嵌套），引导用户去 /admin/kps 新建
 */
'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import {
  type RerunActionState,
  type StagingActionState,
  acceptStagingAction,
  rerunStagingAction,
  searchKpsAction,
} from './actions';
import { MathText } from './math-text';

export interface LlmQuestionPayload {
  content?: string;
  question_type?: 'choice' | 'fill_in';
  options?: Array<{ label: string; text: string }>;
  answer?: string;
  solution_text?: string;
  difficulty?: number;
  kp_hints?: string[];
  source_hint?: { page?: number | null; question_no?: string | null };
  figures?: Array<{ figure_no?: number; alt?: string; bbox?: [number, number, number, number] }>;
  _subject_id?: string;
  _rerun?: { previous_provider_id?: string; matched_strategy?: string };
}

interface KpOption {
  id: string;
  name: string;
  chapter_no: string | null;
}

export interface DiffDrawerProps {
  stagingId: string;
  uploadId: string;
  payload: LlmQuestionPayload;
  subjectId: string;
  subjectLabel: string;
  providers: Array<{ id: string; model: string }>;
  onClose: () => void;
}

const CURRENT_PROVIDER_PREFIXES = ['openai-chat-', 'bedrock-converse-', 'google-generate-content-'];

function displayProviderId(id: string): string {
  if (CURRENT_PROVIDER_PREFIXES.some((prefix) => id.startsWith(prefix))) return id;
  return '旧 Provider';
}

const ACCEPT_INITIAL: StagingActionState = { error: null };
const RERUN_INITIAL: RerunActionState = { error: null };

export function DiffDrawer(props: DiffDrawerProps) {
  const { payload } = props;
  const [acceptState, acceptAction, accepting] = useActionState(
    acceptStagingAction,
    ACCEPT_INITIAL,
  );
  const [rerunState, rerunAction, rerunning] = useActionState(rerunStagingAction, RERUN_INITIAL);

  // 表单 state — 用 LLM 输出作为初值
  const [content, setContent] = useState(payload.content ?? '');
  const [questionType, setQuestionType] = useState<'choice' | 'fill_in'>(
    payload.question_type ?? 'choice',
  );
  const [optionsJson, setOptionsJson] = useState(JSON.stringify(payload.options ?? [], null, 2));
  const [answer, setAnswer] = useState(payload.answer ?? '');
  const [solution, setSolution] = useState(payload.solution_text ?? '');
  const [difficulty, setDifficulty] = useState<number>(payload.difficulty ?? 3);

  // KP 映射 state
  const [selectedKps, setSelectedKps] = useState<KpOption[]>([]);
  const [primaryKpId, setPrimaryKpId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<KpOption[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 初始：用 kp_hints 自动搜一次，把第一个匹配选中作为 primary
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hints = payload.kp_hints ?? [];
      if (hints.length === 0) return;
      try {
        // 并发拉每个 hint 的 top-1
        const results = await Promise.all(hints.map((h) => searchKpsAction(props.subjectId, h, 1)));
        if (cancelled) return;
        const picked: KpOption[] = [];
        const seen = new Set<string>();
        for (const arr of results) {
          for (const k of arr) {
            if (!seen.has(k.id)) {
              seen.add(k.id);
              picked.push(k);
            }
          }
        }
        if (picked.length > 0) {
          setSelectedKps(picked);
          const firstPicked = picked[0];
          if (firstPicked) setPrimaryKpId(firstPicked.id);
        }
      } catch {
        /* 抽屉打开时偶发 401 / 网络抖动，忽略；用户可手动搜 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payload.kp_hints, props.subjectId]);

  // 搜索 debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setCandidates([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchKpsAction(props.subjectId, query, 20);
        setCandidates(res);
      } catch (e) {
        console.warn('searchKps fail', e);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, props.subjectId]);

  const toggleKp = (kp: KpOption) => {
    setSelectedKps((prev) => {
      if (prev.some((k) => k.id === kp.id)) {
        const next = prev.filter((k) => k.id !== kp.id);
        const nextPrimary = next[0];
        if (primaryKpId === kp.id && nextPrimary) setPrimaryKpId(nextPrimary.id);
        else if (next.length === 0) setPrimaryKpId('');
        return next;
      }
      const next = [...prev, kp];
      if (!primaryKpId) setPrimaryKpId(kp.id);
      return next;
    });
  };

  const kpIdsCsv = useMemo(() => selectedKps.map((k) => k.id).join(','), [selectedKps]);

  // F3.6 重跑：换 provider
  const [rerunProvider, setRerunProvider] = useState<string>(props.providers[0]?.id ?? '');

  // accept 成功后关抽屉。用 ref 锁定 onClose，避免父组件每次重渲让 effect 重跑。
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  useEffect(() => {
    if (acceptState.ok) onCloseRef.current();
  }, [acceptState.ok]);

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-stretch justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onClose();
      }}
      role="presentation"
    >
      <aside className="bg-white dark:bg-neutral-900 w-full max-w-5xl shadow-2xl overflow-y-auto">
        <header className="sticky top-0 bg-white dark:bg-neutral-900 border-b px-6 py-3 flex items-center justify-between z-10">
          <div>
            <h2 className="font-semibold text-lg">单题 diff · F3.4 / F3.5 / F3.6</h2>
            <p className="text-xs opacity-60 mt-0.5">
              学科：{props.subjectLabel}
              {payload.source_hint?.page ? ` · 原文 p${payload.source_hint.page}` : ''}
              {payload.source_hint?.question_no ? ` · ${payload.source_hint.question_no}` : ''}
              {payload._rerun?.previous_provider_id
                ? ` · 已重跑（原 ${displayProviderId(payload._rerun.previous_provider_id)} → 新结果 via ${payload._rerun.matched_strategy ?? '?'} 匹配）`
                : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="px-2 py-1 text-sm rounded border hover:bg-black/5 dark:hover:bg-white/10"
          >
            ✕ 关闭
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-6">
          {/* 左栏：LLM 原始抽取 */}
          <section className="space-y-3 text-sm">
            <h3 className="font-medium opacity-80">LLM 抽取（只读 · 公式已渲染）</h3>
            <Block label="content">
              {payload.content ? (
                <MathText block text={payload.content} className="text-sm leading-relaxed" />
              ) : (
                <span className="text-xs opacity-60">—</span>
              )}
            </Block>
            <Block label={`options (${payload.options?.length ?? 0})`}>
              {payload.options && payload.options.length > 0 ? (
                <ul className="text-sm space-y-1">
                  {payload.options.map((o) => (
                    <li key={o.label} className="flex gap-2">
                      <span className="font-mono opacity-70 shrink-0">{o.label}.</span>
                      <MathText text={o.text} />
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-xs opacity-60">—</span>
              )}
            </Block>
            <Block label="answer">
              <MathText text={payload.answer ?? '—'} className="text-sm" />
            </Block>
            <Block label="solution_text">
              {payload.solution_text ? (
                <MathText block text={payload.solution_text} className="text-sm leading-relaxed" />
              ) : (
                <span className="text-xs opacity-60">（空）</span>
              )}
            </Block>
            <Block label={`kp_hints (${payload.kp_hints?.length ?? 0})`}>
              {(payload.kp_hints ?? []).map((h) => (
                <span
                  key={h}
                  className="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded bg-black/5 dark:bg-white/10 text-xs"
                >
                  {h}
                </span>
              ))}
            </Block>
            {payload.figures && payload.figures.length > 0 ? (
              <Block label={`figures (${payload.figures.length})`}>
                <ul className="text-xs space-y-0.5">
                  {payload.figures.map((f, i) => (
                    <li key={f.figure_no ?? i}>
                      #{f.figure_no ?? i + 1} {f.alt ?? ''}{' '}
                      <span className="opacity-50">
                        bbox=[{(f.bbox ?? []).map((n) => n.toFixed(2)).join(', ')}]
                      </span>
                    </li>
                  ))}
                </ul>
              </Block>
            ) : null}
          </section>

          {/* 右栏：编辑 + 接受 */}
          <section className="space-y-3 text-sm">
            <h3 className="font-medium opacity-80">编辑并发布（必填 *）</h3>

            <form action={acceptAction} className="space-y-3">
              <input type="hidden" name="staging_id" value={props.stagingId} />
              <input type="hidden" name="upload_id" value={props.uploadId} />
              <input type="hidden" name="subject_id" value={props.subjectId} />
              <input type="hidden" name="options_json" value={optionsJson} />
              <input type="hidden" name="kp_ids_csv" value={kpIdsCsv} />
              <input type="hidden" name="primary_kp_id" value={primaryKpId} />

              <Field label="content *">
                <textarea
                  name="content"
                  required
                  minLength={5}
                  maxLength={2000}
                  rows={4}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-xs font-mono bg-transparent"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="question_type *">
                  <select
                    name="question_type"
                    value={questionType}
                    onChange={(e) => setQuestionType(e.target.value as 'choice' | 'fill_in')}
                    className="w-full px-2 py-1.5 border rounded text-xs bg-transparent"
                  >
                    <option value="choice">choice</option>
                    <option value="fill_in">fill_in</option>
                  </select>
                </Field>
                <Field label="difficulty * (1-5)">
                  <input
                    type="number"
                    name="difficulty"
                    required
                    min={1}
                    max={5}
                    value={difficulty}
                    onChange={(e) => setDifficulty(Number(e.target.value))}
                    className="w-full px-2 py-1.5 border rounded text-xs bg-transparent"
                  />
                </Field>
              </div>

              <Field label="options (JSON; choice 必填 ≥2，fill_in 留 [])">
                <textarea
                  rows={4}
                  value={optionsJson}
                  onChange={(e) => setOptionsJson(e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-xs font-mono bg-transparent"
                />
              </Field>

              <Field label="answer *">
                <input
                  type="text"
                  name="answer"
                  required
                  minLength={1}
                  maxLength={500}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-xs font-mono bg-transparent"
                />
              </Field>

              <Field label="solution_text">
                <textarea
                  name="solution_text"
                  rows={3}
                  maxLength={3000}
                  value={solution}
                  onChange={(e) => setSolution(e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-xs font-mono bg-transparent"
                />
              </Field>

              {/* F3.5 KP 映射 */}
              <Field label="KP 关联 *（至少 1 个；⭐ 设为 primary）">
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
                    {selectedKps.length === 0 ? (
                      <span className="text-xs opacity-50">尚未选择 — 在下方搜索</span>
                    ) : (
                      selectedKps.map((kp) => {
                        const isPrimary = kp.id === primaryKpId;
                        return (
                          <span
                            key={kp.id}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                              isPrimary ? 'bg-blue-600 text-white' : 'bg-black/5 dark:bg-white/10'
                            }`}
                          >
                            <button
                              type="button"
                              title="设为 primary"
                              onClick={() => setPrimaryKpId(kp.id)}
                              className="cursor-pointer"
                            >
                              {isPrimary ? '⭐' : '☆'}
                            </button>
                            <span>
                              {kp.name}
                              {kp.chapter_no ? (
                                <span className="opacity-70 ml-1">({kp.chapter_no})</span>
                              ) : null}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleKp(kp)}
                              className="opacity-70 hover:opacity-100 cursor-pointer"
                            >
                              ✕
                            </button>
                          </span>
                        );
                      })
                    )}
                  </div>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索同学科 KP（前缀匹配）"
                    className="w-full px-2 py-1.5 border rounded text-xs bg-transparent"
                  />
                  {searching ? (
                    <p className="text-xs opacity-60">搜索中…</p>
                  ) : candidates.length > 0 ? (
                    <ul className="border rounded max-h-40 overflow-y-auto divide-y">
                      {candidates.map((kp) => {
                        const picked = selectedKps.some((k) => k.id === kp.id);
                        return (
                          <li key={kp.id}>
                            <button
                              type="button"
                              onClick={() => toggleKp(kp)}
                              className={`w-full text-left px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10 ${
                                picked ? 'opacity-50' : ''
                              }`}
                            >
                              {picked ? '✓ ' : '+ '} {kp.name}
                              {kp.chapter_no ? (
                                <span className="opacity-60 ml-2">{kp.chapter_no}</span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : query.trim() ? (
                    <p className="text-xs opacity-60">
                      无匹配 KP；请到{' '}
                      <a className="underline" href="/admin/kps">
                        /admin/kps
                      </a>{' '}
                      新建后回到本页（v0.1 抽屉不内联新建）
                    </p>
                  ) : null}
                </div>
              </Field>

              {acceptState.error ? (
                <p className="text-xs text-red-600" role="alert">
                  ⚠️ {acceptState.error}
                </p>
              ) : null}

              <div className="flex items-center gap-3 pt-2 border-t mt-3">
                <button
                  type="submit"
                  disabled={accepting || selectedKps.length === 0 || !primaryKpId}
                  className="px-4 py-2 rounded bg-green-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {accepting ? '发布中…' : '✅ 接受并发布到 question'}
                </button>
                <span className="text-xs opacity-60">
                  T3 校验：question_type / kp_ids.len≥1 / primary∈kp_ids；T4：同事务写 audit_log
                </span>
              </div>
            </form>

            {/* F3.6 单条重跑 */}
            <form
              action={rerunAction}
              className="mt-4 pt-3 border-t border-dashed flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="staging_id" value={props.stagingId} />
              <div>
                <label className="block text-xs opacity-70 mb-1" htmlFor="rerun-provider">
                  换模型重跑（F3.6 / T7）
                </label>
                <select
                  id="rerun-provider"
                  name="provider_id"
                  value={rerunProvider}
                  onChange={(e) => setRerunProvider(e.target.value)}
                  className="px-2 py-1.5 border rounded text-xs bg-transparent"
                >
                  {props.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id}（{p.model}）
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={rerunning || !rerunProvider}
                className="px-3 py-1.5 rounded border text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
              >
                {rerunning ? '重跑中…（窗口 ±1 页）' : '🔄 重跑此题'}
              </button>
              {rerunState.error ? (
                <p className="basis-full text-xs text-red-600">{rerunState.error}</p>
              ) : null}
              {rerunState.ok ? (
                <p className="basis-full text-xs text-green-700">
                  ✅ 已重跑；关闭抽屉后页面会刷新拿新数据
                </p>
              ) : null}
            </form>
          </section>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // 不用 <label>：children 的输入控件不一定带 id，biome a11y 规则会拒；
  // 改为纯 div + span 容器，控件本身仍由 form 提交字段名（不依赖 label htmlFor 关联）。
  return (
    <div>
      <span className="block text-xs opacity-70 mb-1">{label}</span>
      {children}
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border rounded p-2 bg-black/3 dark:bg-white/5">
      <p className="text-[10px] opacity-60 uppercase tracking-wider mb-1">{label}</p>
      {children}
    </div>
  );
}
