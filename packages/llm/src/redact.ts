/**
 * 脱敏 — LLM 请求 body 入库前必经
 *
 * 调用方（admin route）在拿到 callLLM 返回的 requestPayload 后，调用
 * redactAuthHeaders 再写入 llm_parse_job.request_payload。原始 token /
 * api_key / cookie 永远不入库（运营端 PRD §6 + §8 验收清单强约束）。
 *
 * 设计原则：
 *   - 纯函数：不修改入参，深克隆后返回
 *   - 大小写不敏感的 header key 匹配（HTTP header 不区分大小写）
 *   - body 关键字字段精确匹配（avoid 把"token 数量"这类业务字段误杀）
 *   - 兜底：任何字符串值若以 "Bearer " 开头，整段替换
 */

const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'cookie',
  'set-cookie',
  'proxy-authorization',
]);

/** 精确匹配（大小写敏感）。命中即替换，避免误杀业务字段如 token_usage / max_tokens */
const SENSITIVE_BODY_KEYS = new Set([
  'api_key',
  'apiKey',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'secret',
  'client_secret',
  'clientSecret',
]);

const REDACTED = '***REDACTED***';
const BEARER_REDACTED = 'Bearer ***REDACTED***';

/**
 * 深克隆并替换所有敏感字段。原对象不被修改。
 *
 * @param payload 任意 JSON-shaped 对象（headers / body / 整个 requestInit 都行）
 */
export function redactAuthHeaders<T>(payload: T): T {
  return walk(payload, undefined) as T;
}

function walk(node: unknown, parentKey: string | undefined): unknown {
  if (node === null || node === undefined) return node;
  if (typeof node !== 'object') {
    return maybeRedactString(node, parentKey);
  }
  if (Array.isArray(node)) {
    return node.map((item) => walk(item, parentKey));
  }
  // plain object
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
    if (isSensitiveHeader(key) || isSensitiveBody(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = walk(val, key);
  }
  return out;
}

function maybeRedactString(val: unknown, parentKey: string | undefined): unknown {
  if (typeof val !== 'string') return val;
  // 父字段已是敏感 key 时已在上层替换；这里只兜底"裸 Bearer 串"出现在普通字段里的情况
  if (val.startsWith('Bearer ') && val.length > 'Bearer '.length) {
    return BEARER_REDACTED;
  }
  return val;
}

function isSensitiveHeader(key: string): boolean {
  return SENSITIVE_HEADER_KEYS.has(key.toLowerCase());
}

function isSensitiveBody(key: string): boolean {
  return SENSITIVE_BODY_KEYS.has(key);
}
