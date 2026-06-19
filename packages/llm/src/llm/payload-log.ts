// @ts-nocheck
export function formatPayloadLog({ request, attempts, limit = 20000 }) {
  const sections = [
    '=== REQUEST ===',
    stringifyForLog(
      {
        method: request.method,
        url: request.url,
        headers: redactHeaders(request.headers ?? {}),
        body: sanitizePayloadForLog(request.body ?? null),
      },
      limit,
    ),
  ];

  for (const attempt of attempts) {
    sections.push(`=== RESPONSE attempt ${attempt.index} ===`);
    sections.push(
      stringifyForLog(
        {
          http_status: attempt.http_status,
          latency_ms: attempt.latency_ms,
          retry_after: attempt.retry_after ?? null,
          headers: redactHeaders(attempt.headers ?? {}),
          body: sanitizePayloadForLog(attempt.body ?? null),
          error_message: attempt.error_message ?? null,
        },
        limit,
      ),
    );
  }

  return sections.join('\n');
}

export function sanitizePayloadForLog(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizePayloadForLog(item));
  if (!value || typeof value !== 'object') return value;

  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = binaryPayloadPlaceholder(key, entry) ?? sanitizePayloadForLog(entry);
  }
  return sanitized;
}

function stringifyForLog(value, limit) {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n...<truncated ${text.length - limit} chars>`;
}

function redactHeaders(headers) {
  const redacted = { ...headers };
  for (const key of Object.keys(redacted)) {
    if (key.toLowerCase() === 'authorization') {
      redacted[key] = 'Bearer <redacted>';
    }
  }
  return redacted;
}

function binaryPayloadPlaceholder(key, value) {
  if (typeof value !== 'string') return null;
  if (['bytes', 'data', 'file_data'].includes(key.toLowerCase())) {
    return `<base64 omitted: ${base64PayloadLength(value)} chars>`;
  }
  if (isDataUrl(value)) {
    return `<base64 omitted: ${base64PayloadLength(value)} chars>`;
  }
  return null;
}

function base64PayloadLength(value) {
  const marker = ';base64,';
  const markerIndex = value.indexOf(marker);
  return markerIndex >= 0 ? value.slice(markerIndex + marker.length).length : value.length;
}

function isDataUrl(value) {
  return /^data:[^,]+;base64,/i.test(value);
}
