'use client';

import { useActionState } from 'react';
import {
  type LearningResourceEntityActionState,
  acceptLearningMaterialStagingAction,
  acceptSourceDocumentStagingAction,
  rejectStagingAction,
} from './actions';
import { MathText } from './math-text';

type EntityKind = 'source_document' | 'learning_material';

export interface SupportingStagingCardProps {
  stagingId: string;
  uploadId: string;
  subjectId: string;
  entityKind: EntityKind;
  payload: Record<string, unknown>;
}

const INITIAL: LearningResourceEntityActionState = { error: null };

const SOURCE_TYPE_LABELS: Record<string, string> = {
  lesson_handout: '辅导讲义 / PPT',
  workbook: '练习册 / 辅导教材',
  question_pack: '题集 / 习题图',
  exam_paper: '完整试卷',
  answer_book: '答案解析册',
  mixed_material: '混合学习资料',
  textbook: '教材',
};

const MATERIAL_TYPE_LABELS: Record<string, string> = {
  concept_explanation: '概念说明',
  method_card: '解题方法',
  common_mistake: '易错提醒',
  question_type_summary: '题型总结',
  exam_trend: '考情分析',
  textbook_deep_dive: '教材深挖',
  solution_summary: '解析总结',
  study_advice: '学习建议',
};

export function SupportingStagingCard(props: SupportingStagingCardProps) {
  const acceptAction =
    props.entityKind === 'source_document'
      ? acceptSourceDocumentStagingAction
      : acceptLearningMaterialStagingAction;
  const [state, formAction, pending] = useActionState(acceptAction, INITIAL);
  const title = stringValue(props.payload.title) || '未命名内容';
  const content = stringValue(props.payload.content);
  const type =
    props.entityKind === 'source_document'
      ? SOURCE_TYPE_LABELS[stringValue(props.payload.source_type)] || '学习资料'
      : MATERIAL_TYPE_LABELS[stringValue(props.payload.material_type)] || '学习材料';
  const sourceRef = sourceRefLabel(props.payload.source_ref);
  const kpHints = stringArray(props.payload.kp_hints);

  return (
    <article className="border rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs opacity-60">{type}</p>
          <h3 className="font-medium text-sm">{title}</h3>
        </div>
        {sourceRef ? <span className="text-xs opacity-60 shrink-0">{sourceRef}</span> : null}
      </div>

      {content ? <MathText block text={content} className="text-sm leading-relaxed" /> : null}

      {kpHints.length > 0 ? (
        <div className="text-xs">
          <span className="opacity-60">关联知识点线索 </span>
          {kpHints.map((hint) => (
            <span
              key={hint}
              className="inline-block px-1.5 py-0.5 mr-1 rounded bg-black/5 dark:bg-white/10"
            >
              {hint}
            </span>
          ))}
        </div>
      ) : null}

      {state.error ? (
        <p className="text-xs text-red-600" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <form action={formAction}>
          <input type="hidden" name="staging_id" value={props.stagingId} />
          <input type="hidden" name="upload_id" value={props.uploadId} />
          <input type="hidden" name="subject_id" value={props.subjectId} />
          <button
            type="submit"
            disabled={pending}
            className="px-3 py-1.5 rounded bg-black text-white text-xs font-medium disabled:opacity-60 dark:bg-white dark:text-black"
          >
            {pending
              ? '处理中…'
              : props.entityKind === 'source_document'
                ? '确认来源资料'
                : '发布学习材料'}
          </button>
        </form>
        <form
          action={rejectStagingAction}
          onSubmit={(e) => {
            if (!confirm('确认丢弃这条待审核内容？')) e.preventDefault();
          }}
        >
          <input type="hidden" name="staging_id" value={props.stagingId} />
          <input type="hidden" name="upload_id" value={props.uploadId} />
          <button
            type="submit"
            className="text-xs px-2 py-1 rounded border opacity-70 hover:opacity-100"
          >
            丢弃
          </button>
        </form>
      </div>
    </article>
  );
}

function sourceRefLabel(value: unknown): string {
  const record = asRecord(value);
  if (!record) return '';
  const parts = [];
  if (record.page) parts.push(`p${record.page}`);
  if (record.slide_no) parts.push(`slide ${record.slide_no}`);
  if (record.question_no) parts.push(String(record.question_no));
  return parts.join(' · ');
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item).trim()).filter(Boolean);
}

function stringValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
