import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { providerToTarget } from './provider-target';

const BASE_PROVIDER = {
  id: 'openai-chat-gemini-3.1-pro',
  protocol: 'openai_chat',
  endpoint: 'https://example.com/openai/v1/chat/completions',
  model: 'google.gemini-3.1-pro-global',
  auth_env_var: 'LLM_PROXY_API_KEY',
  enabled: true,
};

beforeEach(() => {
  process.env.LLM_PROXY_API_KEY = 'test-token-xyz';
});

afterEach(() => {
  process.env.LLM_PROXY_API_KEY = undefined;
});

describe('providerToTarget', () => {
  it('maps DB provider metadata to the synced llmTarget contract', () => {
    const result = providerToTarget({
      ...BASE_PROVIDER,
      default_params: { temperature: 0.2, max_tokens: 8192 },
      max_output_tokens: null,
      quirks: {},
    });

    expect(result.apiKey).toBe('test-token-xyz');
    expect(result.llmTarget).toEqual({
      id: 'openai-chat-gemini-3.1-pro',
      provider: 'openai_chat',
      api_shape: 'openai-chat-completions',
      model: 'google.gemini-3.1-pro-global',
      path: 'https://example.com/openai/v1/chat/completions',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ${LLM_PROXY_API_KEY}',
      },
    });
    expect(result.defaults).toEqual({
      temperature: 0.2,
      maxTokens: 8192,
    });
  });

  it('does not pass max_tokens when the provider requires a non-default token parameter', () => {
    const result = providerToTarget({
      ...BASE_PROVIDER,
      id: 'openai-chat-gpt-5.4',
      model: 'gpt-5.4',
      default_params: { temperature: 0.2, max_tokens: 16384 },
      max_output_tokens: null,
      quirks: { max_tokens_param_name: 'max_completion_tokens' },
    });

    expect(result.defaults).toEqual({
      temperature: 0.2,
      maxTokens: undefined,
    });
  });

  it('maps Bedrock Converse provider records to the synced llmTarget api shape', () => {
    const result = providerToTarget({
      ...BASE_PROVIDER,
      id: 'bedrock-converse-claude-opus-4.7',
      protocol: 'bedrock_converse',
      endpoint:
        'https://example.com/bedrock/v1/model/anthropic.claude-opus-4-7/converse',
      model: 'anthropic.claude-opus-4-7',
      default_params: { max_tokens: 16384 },
      max_output_tokens: null,
      quirks: { supports_temperature: false, supports_response_format: false },
    });

    expect(result.llmTarget).toEqual({
      id: 'bedrock-converse-claude-opus-4.7',
      provider: 'bedrock_converse',
      api_shape: 'bedrock-converse',
      model: 'anthropic.claude-opus-4-7',
      path: 'https://example.com/bedrock/v1/model/anthropic.claude-opus-4-7/converse',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ${LLM_PROXY_API_KEY}',
      },
    });
    expect(result.defaults).toEqual({
      temperature: undefined,
      maxTokens: 16384,
    });
  });
});
