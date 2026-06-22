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
import { stripDuplicatedChoiceOptionsFromContent } from '../../../../../lib/question-content';
import { questionTypeLabel } from '../../../../../lib/question-type-label';
import {
  type AnswerDraftActionState,
  type RerunActionState,
  type StagingActionState,
  acceptStagingAction,
  generateAnswerDraftAction,
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
  quality_status?: string;
  source_hint?: { page?: number | null; question_no?: string | null };
  source_ref?: Record<string, unknown>;
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
  draftProviders: Array<{ id: string; model: string }>;
  initialFocusAnswerDraft?: boolean;
  onClose: () => void;
}

const ACCEPT_INITIAL: StagingActionState = { error: null };
const RERUN_INITIAL: RerunActionState = { error: null };
const ANSWER_DRAFT_INITIAL: AnswerDraftActionState = { error: null };

export function DiffDrawer(props: DiffDrawerProps) {
  const { payload } = props;
  const displayContent = stripDuplicatedChoiceOptionsFromContent(
    payload.content ?? '',
    payload.options ?? [],
  );
  const [acceptState, acceptAction, accepting] = useActionState(
    acceptStagingAction,
    ACCEPT_INITIAL,
  );
  const [rerunState, rerunAction, rerunning] = useActionState(rerunStagingAction, RERUN_INITIAL);
  const [answerDraftState, answerDraftAction, draftingAnswer] = useActionState(
    generateAnswerDraftAction,
    ANSWER_DRAFT_INITIAL,
  );

  // 表单 state — 用 LLM 输出作为初值
  const [content, setContent] = useState(displayContent);
  const [questionType, setQuestionType] = useState<'choice' | 'fill_in'>(
    payload.question_type ?? 'choice',
  );
  const [optionsJson, setOptionsJson] = useState(JSON.stringify(payload.options ?? [], null, 2));
  const [answer, setAnswer] = useState(payload.answer ?? '');
  const [solution, setSolution] = useState(payload.solution_text ?? '');
  const [difficulty, setDifficulty] = useState<number>(payload.difficulty ?? 3);
  const [draftProvider, setDraftProvider] = useState<string>(
    props.draftProviders[0]?.id ?? props.providers[0]?.id ?? '',
  );

  // KP 映射 state
  const [selectedKps, setSelectedKps] = useState<KpOption[]>([]);
  const [primaryKpId, setPrimaryKpId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<KpOption[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answerDraftSectionRef = useRef<HTMLElement | null>(null);
  const isMissingAnswerDraftCandidate =
    (payload.answer ?? '').trim() === '' && payload.quality_status === 'missing_answer';

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

  useEffect(() => {
    if (!props.initialFocusAnswerDraft || !isMissingAnswerDraftCandidate) return;
    answerDraftSectionRef.current?.scrollIntoView({ block: 'start' });
  }, [props.initialFocusAnswerDraft, isMissingAnswerDraftCandidate]);

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
            <h2 className="font-semibold text-lg">题目审核</h2>
            <p className="text-xs opacity-60 mt-0.5">
              学科：{props.subjectLabel}
              {' · '}
              题型：{questionTypeLabel(payload.question_type)}
              {payload.source_hint?.page ? ` · 原文 p${payload.source_hint.page}` : ''}
              {payload.source_hint?.question_no ? ` · ${payload.source_hint.question_no}` : ''}
              {payload._rerun?.previous_provider_id
                ? ` · 已重跑（${rerunStrategyLabel(payload._rerun.matched_strategy)}匹配）`
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
          {/* 左栏：模型原始抽取 */}
          <section className="space-y-3 text-sm">
            <h3 className="font-medium opacity-80">模型抽取结果（只读 · 公式已渲染）</h3>
            <Block label="题干">
              {displayContent ? (
                <MathText block text={displayContent} className="text-sm leading-relaxed" />
              ) : (
                <span className="text-xs opacity-60">—</span>
              )}
            </Block>
            <Block label={`选项（${payload.options?.length ?? 0}）`}>
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
            <Block label="答案">
              <MathText text={payload.answer ?? '—'} className="text-sm" />
            </Block>
            <Block label="解析">
              {payload.solution_text ? (
                <MathText block text={payload.solution_text} className="text-sm leading-relaxed" />
              ) : (
                <span className="text-xs opacity-60">（空）</span>
              )}
            </Block>
            <Block label={`知识点线索（${payload.kp_hints?.length ?? 0}）`}>
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
              <Block label={`图示信息（${payload.figures.length}）`}>
                <ul className="text-xs space-y-0.5">
                  {payload.figures.map((f, i) => (
                    <li key={f.figure_no ?? i}>
                      #{f.figure_no ?? i + 1} {f.alt ?? ''}{' '}
                      <span className="opacity-50">
                        位置=[{(f.bbox ?? []).map((n) => n.toFixed(2)).join(', ')}]
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

            {isMissingAnswerDraftCandidate ? (
              <section
                ref={answerDraftSectionRef}
                className="border rounded p-3 bg-amber-50/70 dark:bg-amber-950/20 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">AI 生成参考解答草稿</p>
                    <p className="text-xs opacity-70 mt-0.5">
                      AI 生成，仅供审核；不会自动发布，也不会改原始缺答案状态。
                    </p>
                  </div>
                  {props.draftProviders.length > 0 ? (
                    <form action={answerDraftAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="staging_id" value={props.stagingId} />
                      <select
                        name="provider_id"
                        value={draftProvider}
                        onChange={(event) => setDraftProvider(event.target.value)}
                        className="px-2 py-1.5 border rounded text-xs bg-white dark:bg-neutral-900"
                      >
                        {props.draftProviders.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.model}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={draftingAnswer || !draftProvider}
                        className="px-3 py-1.5 rounded bg-amber-600 text-white text-xs font-medium disabled:opacity-50"
                      >
                        {draftingAnswer ? '生成中…' : 'AI 生成参考解答'}
                      </button>
                    </form>
                  ) : (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      没有可用 LLM 模型，请先到 LLM 设置启用模型。
                    </p>
                  )}
                </div>

                {answerDraftState.error ? (
                  <p className="text-xs text-red-600" role="alert">
                    ⚠️ {answerDraftState.error}
                  </p>
                ) : null}

                {answerDraftState.draft ? (
                  <div className="space-y-3 border-t pt-3">
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                      参考解答草稿 / AI 生成，仅供审核
                    </p>
                    {answerDraftState.draft.warnings.length > 0 ||
                    !answerDraftState.draft.answer.trim() ? (
                      <div className="text-xs text-amber-800 dark:text-amber-200 space-y-1">
                        {!answerDraftState.draft.answer.trim() ? <p>草稿没有给出答案。</p> : null}
                        <p>
                          本次没有生成可用参考解答；可换模型重试。若多次失败，请联系技术同学处理公共解析能力。
                        </p>
                        {answerDraftState.draft.warnings.map((warning) => (
                          <p key={warning}>⚠️ {warning}</p>
                        ))}
                      </div>
                    ) : null}
                    <Block label="草稿答案">
                      {answerDraftState.draft.answer ? (
                        <MathText text={answerDraftState.draft.answer} className="text-sm" />
                      ) : (
                        <span className="text-xs opacity-60">（空）</span>
                      )}
                    </Block>
                    <Block label="草稿解析">
                      {answerDraftState.draft.solution_text ? (
                        <MathText
                          block
                          text={answerDraftState.draft.solution_text}
                          className="text-sm leading-relaxed"
                        />
                      ) : (
                        <span className="text-xs opacity-60">（空）</span>
                      )}
                    </Block>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={!answerDraftState.draft.can_apply}
                        onClick={() => {
                          if (!answerDraftState.draft?.can_apply) return;
                          setAnswer(answerDraftState.draft.answer);
                          setSolution(answerDraftState.draft.solution_text);
                        }}
                        className="px-3 py-1.5 rounded bg-black text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed dark:bg-white dark:text-black"
                      >
                        应用到审核字段
                      </button>
                      <span className="text-xs opacity-60">
                        有警告或答案为空时不会覆盖当前字段。
                      </span>
                    </div>
                    <details className="text-xs opacity-70">
                      <summary className="cursor-pointer">技术详情</summary>
                      <div className="mt-1 space-y-1">
                        <p>prompt：{answerDraftState.draft.prompt_version}</p>
                        <p>来源：{answerDraftState.draft.draft_source}</p>
                        {answerDraftState.draft.confidence != null ? (
                          <p>置信度：{answerDraftState.draft.confidence}</p>
                        ) : null}
                      </div>
                    </details>
                  </div>
                ) : null}
              </section>
            ) : null}

            <form action={acceptAction} className="space-y-3">
              <input type="hidden" name="staging_id" value={props.stagingId} />
              <input type="hidden" name="upload_id" value={props.uploadId} />
              <input type="hidden" name="subject_id" value={props.subjectId} />
              <input type="hidden" name="options_json" value={optionsJson} />
              <input type="hidden" name="kp_ids_csv" value={kpIdsCsv} />
              <input type="hidden" name="primary_kp_id" value={primaryKpId} />

              <Field label="题干 *">
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
                <Field label="题型 *">
                  <select
                    name="question_type"
                    value={questionType}
                    onChange={(e) => setQuestionType(e.target.value as 'choice' | 'fill_in')}
                    className="w-full px-2 py-1.5 border rounded text-xs bg-transparent"
                  >
                    <option value="choice">{questionTypeLabel('choice')}</option>
                    <option value="fill_in">{questionTypeLabel('fill_in')}</option>
                  </select>
                </Field>
                <Field label="难度 *（1-5）">
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

              <Field label="选项（选择题至少 2 个；填空题无需填写）">
                <textarea
                  rows={4}
                  value={optionsJson}
                  onChange={(e) => setOptionsJson(e.target.value)}
                  className="w-full px-2 py-1.5 border rounded text-xs font-mono bg-transparent"
                />
              </Field>

              <Field label="答案 *">
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

              <Field label="解析">
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
              <Field label="知识点关联 *（至少 1 个；⭐ 设为主知识点）">
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
                              title="设为主知识点"
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
                  {accepting ? '发布中…' : '✅ 接受并发布题目'}
                </button>
                <span className="text-xs opacity-60">
                  发布校验：题型 / 知识点关联 / 主知识点；同时记录审核日志
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
                  换模型重新解析此题
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
                      {p.model}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={rerunning || !rerunProvider}
                className="px-3 py-1.5 rounded border text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
              >
                {rerunning ? '重新解析中…（参考相邻页面）' : '🔄 重新解析此题'}
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

function rerunStrategyLabel(value: string | undefined): string {
  return value === 'question_no' ? '题号' : '题干';
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
