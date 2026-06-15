import { prisma } from '@hao/db';
import type { LlmTarget } from '../types/public-types.ts';

interface ProviderRecord {
  id: string;
  protocol: string;
  endpoint: string;
  model: string;
  auth_env_var: string;
  default_params?: unknown;
  max_output_tokens?: number | null;
  quirks?: unknown;
  enabled: boolean;
}

export interface ResolvedProviderTarget {
  llmTarget: LlmTarget;
  apiKey: string;
  defaults: {
    temperature?: number;
    maxTokens?: number;
  };
}

export async function resolveProviderTarget(providerId: string): Promise<ResolvedProviderTarget> {
  if (!providerId) throw new Error('providerId is required');

  const provider = await prisma.llm_provider.findUnique({
    where: { id: providerId },
  });
  if (!provider) throw new Error(`llm_provider not found: ${providerId}`);
  return providerToTarget(provider as ProviderRecord);
}

export function providerToTarget(provider: ProviderRecord): ResolvedProviderTarget {
  if (!provider.enabled) throw new Error(`llm_provider disabled: ${provider.id}`);

  const apiKey = process.env[provider.auth_env_var];
  if (!apiKey) {
    throw new Error(`env var ${provider.auth_env_var} not set; required by provider ${provider.id}`);
  }
  const endpoint = resolveEndpoint(provider.endpoint, provider.id);

  const defaultParams = toRecord(provider.default_params);
  const quirks = toRecord(provider.quirks);
  const temperature =
    quirks.supports_temperature !== false && typeof defaultParams.temperature === 'number'
      ? defaultParams.temperature
      : undefined;
  const maxTokenParamName = quirks.max_tokens_param_name;
  const supportsDefaultMaxTokensParam =
    maxTokenParamName == null || maxTokenParamName === 'max_tokens';
  const maxTokens = supportsDefaultMaxTokensParam
    ? typeof provider.max_output_tokens === 'number'
      ? provider.max_output_tokens
      : typeof defaultParams.max_tokens === 'number'
        ? defaultParams.max_tokens
        : undefined
    : undefined;

  return {
    llmTarget: {
      id: provider.id,
      provider: provider.protocol,
      api_shape: apiShapeForProtocol(provider.protocol),
      model: provider.model,
      path: endpoint,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ${LLM_PROXY_API_KEY}',
      },
    },
    apiKey,
    defaults: {
      temperature,
      maxTokens,
    },
  };
}

function apiShapeForProtocol(protocol: string) {
  switch (protocol) {
    case 'openai_chat':
      return 'openai-chat-completions';
    case 'google_generate_content':
      return 'google-generate-content';
    case 'bedrock_converse':
      return 'bedrock-converse';
    default:
      throw new Error(`Unknown LLM protocol: ${protocol}`);
  }
}

function resolveEndpoint(endpoint: string, providerId: string): string {
  if (!endpoint.startsWith('env:')) return endpoint;

  const envVar = endpoint.slice('env:'.length).trim();
  if (!envVar) throw new Error(`empty endpoint env reference for provider ${providerId}`);

  const value = process.env[envVar]?.trim();
  if (!value) throw new Error(`env var ${envVar} not set; required as endpoint by provider ${providerId}`);
  return value;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
