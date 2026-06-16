import { type ObjectStore, StoragePaths, createStore } from '@hao/storage';

const DEFAULT_CONCURRENCY = 1;
const DEFAULT_MAX_RETRIES = 2;
const MAX_CONCURRENCY = 6;
const MAX_RETRIES = 6;

export interface QuestionAnalysisRuntime {
  concurrency: number;
  maxRetries: number;
}

export interface AdminDocumentCache extends Record<string, unknown> {
  type: 'storage';
  namespace: string;
  getJson(key: string): Promise<unknown | null>;
  setJson(key: string, value: unknown): Promise<void>;
}

export function resolveQuestionAnalysisRuntime(
  env: Record<string, string | undefined> = process.env,
): QuestionAnalysisRuntime {
  return {
    concurrency: boundedInt(env.ADMIN_QUESTION_PARSE_CONCURRENCY, {
      defaultValue: DEFAULT_CONCURRENCY,
      min: 1,
      max: MAX_CONCURRENCY,
    }),
    maxRetries: boundedInt(env.ADMIN_QUESTION_PARSE_MAX_RETRIES, {
      defaultValue: DEFAULT_MAX_RETRIES,
      min: 0,
      max: MAX_RETRIES,
    }),
  };
}

export function createQuestionAnalysisCache(namespace = 'question-analysis'): AdminDocumentCache {
  return createStorageDocumentCache({
    store: createStore(),
    namespace,
  });
}

export function createStorageDocumentCache({
  store,
  namespace,
}: {
  store: Pick<ObjectStore, 'get' | 'put'>;
  namespace: string;
}): AdminDocumentCache {
  return {
    type: 'storage',
    namespace,
    async getJson(key: string) {
      try {
        const raw = await store.get(cacheStorageKey(namespace, key));
        const parsed = JSON.parse(raw.toString('utf8')) as { value?: unknown };
        return parsed.value ?? null;
      } catch (e) {
        if (isStorageNotFound(e)) return null;
        throw e;
      }
    },
    async setJson(key: string, value: unknown) {
      await store.put(
        cacheStorageKey(namespace, key),
        Buffer.from(
          JSON.stringify({
            schema_version: 1,
            key,
            stored_at: new Date().toISOString(),
            value,
          }),
          'utf8',
        ),
        { contentType: 'application/json' },
      );
    },
  };
}

export function questionParseJobStatus(status: string): 'succeeded' | 'failed' {
  return status === 'ok' ? 'succeeded' : 'failed';
}

function boundedInt(
  value: string | undefined,
  opts: { defaultValue: number; min: number; max: number },
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < opts.min || parsed > opts.max) {
    return opts.defaultValue;
  }
  return parsed;
}

function cacheStorageKey(namespace: string, key: string): string {
  return StoragePaths.derived(key, 'llm-cache', 'v1', `${safeNamespace(namespace)}.json`);
}

function safeNamespace(namespace: string): string {
  return String(namespace || 'default').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function isStorageNotFound(e: unknown): boolean {
  return (
    e instanceof Error &&
    'code' in e &&
    (e as Error & { code?: string }).code === 'STORAGE_NOT_FOUND'
  );
}
