import { prisma } from '@hao/db';

export interface AdminLlmProvider {
  id: string;
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

export async function listLlmProviders(opts: { enabledOnly?: boolean } = {}) {
  if (opts.enabledOnly) {
    return prisma.$queryRawUnsafe<AdminLlmProvider[]>(
      `SELECT ${PROVIDER_COLUMNS} FROM llm_provider WHERE enabled = true ORDER BY id ASC`,
    );
  }
  return prisma.$queryRawUnsafe<AdminLlmProvider[]>(
    `SELECT ${PROVIDER_COLUMNS} FROM llm_provider ORDER BY id ASC`,
  );
}

export async function getLlmProviderById(id: string): Promise<AdminLlmProvider | null> {
  const rows = await prisma.$queryRawUnsafe<AdminLlmProvider[]>(
    `SELECT ${PROVIDER_COLUMNS} FROM llm_provider WHERE id = $1 LIMIT 1`,
    id,
  );
  return rows[0] ?? null;
}

export async function setLlmProviderEnabled(id: string, enabled: boolean): Promise<void> {
  await prisma.$executeRawUnsafe('UPDATE llm_provider SET enabled = $1 WHERE id = $2', enabled, id);
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
