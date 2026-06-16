import { prisma } from '@hao/db';

export interface AdminLlmProvider {
  id: string;
  db_id: string;
  protocol: string;
  endpoint: string;
  model: string;
  capabilities: unknown;
  auth_env_var: string;
  default_params: unknown;
  max_output_tokens: number | null;
  quirks: unknown;
  output_normalizers: string[];
  enabled: boolean;
  created_at: Date;
}

const PROVIDER_COLUMNS = `
  id,
  protocol::text AS protocol,
  endpoint,
  model,
  capabilities,
  auth_env_var,
  default_params,
  max_output_tokens,
  quirks,
  output_normalizers,
  enabled,
  created_at
`;

const CURRENT_PROVIDER_PREFIXES = ['openai-chat-', 'bedrock-converse-', 'google-generate-content-'];

function hasCurrentProviderPrefix(id: string): boolean {
  return CURRENT_PROVIDER_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function providerPrefixForProtocol(protocol: string): string | null {
  switch (protocol) {
    case 'openai_chat':
      return 'openai-chat';
    case 'bedrock_converse':
      return 'bedrock-converse';
    case 'google_generate_content':
      return 'google-generate-content';
    default:
      return null;
  }
}

function modelSlugForProvider(model: string): string {
  const namespaced =
    model.startsWith('google.') || model.startsWith('anthropic.')
      ? model.slice(model.indexOf('.') + 1)
      : model;
  return namespaced
    .replace(/-global$/, '')
    .replace(/-preview$/, '')
    .replace(/opus-4-7$/, 'opus-4.7');
}

function publicProviderIdForRow(row: Pick<AdminLlmProvider, 'id' | 'protocol' | 'model'>): string {
  if (hasCurrentProviderPrefix(row.id)) return row.id;

  const prefix = providerPrefixForProtocol(row.protocol);
  if (!prefix) return row.id;

  return `${prefix}-${modelSlugForProvider(row.model)}`;
}

export function resolveLlmProviderId(
  id: string,
  providers: Array<Pick<AdminLlmProvider, 'id' | 'db_id'>>,
): string | null {
  if (!id) return null;

  const matchedProvider = providers.find((provider) => provider.id === id || provider.db_id === id);
  if (matchedProvider) return matchedProvider.id;

  return hasCurrentProviderPrefix(id) ? id : null;
}

export function displayLlmProviderId(
  id: string,
  providers: Array<Pick<AdminLlmProvider, 'id' | 'db_id'>> = [],
): string {
  const resolved = resolveLlmProviderId(id, providers);
  if (resolved) return resolved;

  if (!id) return '';
  return '旧 Provider（请更新 env / seed）';
}

function toPublicProvider(row: Omit<AdminLlmProvider, 'db_id'>): AdminLlmProvider {
  return {
    ...row,
    db_id: row.id,
    id: publicProviderIdForRow(row),
  };
}

function dedupeProviders(rows: AdminLlmProvider[]): AdminLlmProvider[] {
  const byId = new Map<string, AdminLlmProvider>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing || (existing.db_id !== existing.id && row.db_id === row.id)) {
      byId.set(row.id, row);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

async function selectLlmProviderRows(
  whereSql = '',
  ...params: unknown[]
): Promise<AdminLlmProvider[]> {
  const rows = await prisma.$queryRawUnsafe<Array<Omit<AdminLlmProvider, 'db_id'>>>(
    `SELECT ${PROVIDER_COLUMNS} FROM llm_provider ${whereSql} ORDER BY id ASC`,
    ...params,
  );
  return rows.map(toPublicProvider);
}

async function selectLlmProviders(
  whereSql = '',
  ...params: unknown[]
): Promise<AdminLlmProvider[]> {
  return dedupeProviders(await selectLlmProviderRows(whereSql, ...params));
}

export async function listLlmProviders(opts: { enabledOnly?: boolean } = {}) {
  if (opts.enabledOnly) {
    return selectLlmProviders('WHERE enabled = true');
  }
  return selectLlmProviders();
}

export async function getLlmProviderById(id: string): Promise<AdminLlmProvider | null> {
  const rows = await selectLlmProviderRows();
  return rows.find((row) => row.id === id || row.db_id === id) ?? null;
}

export async function setLlmProviderEnabled(id: string, enabled: boolean): Promise<void> {
  const provider = await getLlmProviderById(id);
  await prisma.$executeRawUnsafe(
    'UPDATE llm_provider SET enabled = $1 WHERE id = $2',
    enabled,
    provider?.db_id ?? id,
  );
}

const DOCUMENT_ANALYSIS_PROTOCOLS = new Set(['openai_chat', 'bedrock_converse']);

export function isDocumentAnalysisProvider(
  provider: Pick<AdminLlmProvider, 'protocol' | 'capabilities'>,
) {
  const caps = provider.capabilities as { vision?: boolean } | null;
  return DOCUMENT_ANALYSIS_PROTOCOLS.has(provider.protocol) && caps?.vision === true;
}

export function documentAnalysisProtocolLabel(): string {
  return '支持的文档解析协议 + vision=true';
}
