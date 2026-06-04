/**
 * 极简 zod → JSON Schema 转换器
 *
 * 为什么不用 `zod-to-json-schema` 三方包：v0.1 schema 形态有限（object / string /
 * number / array / boolean / nullable / optional / enum），手写 50 行可控；后续如
 * schema 复杂度增长（oneOf / discriminatedUnion）再换三方。
 *
 * 输出兼容 OpenAI structured-output 与 Google responseSchema 两种消费者的最小子集。
 */
import { z, type ZodTypeAny } from 'zod';

export function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  return convert(schema);
}

function convert(s: ZodTypeAny): Record<string, unknown> {
  // 解开 Optional / Nullable / Default 等包装层
  if (s instanceof z.ZodOptional) return convert(s.unwrap());
  if (s instanceof z.ZodDefault) return convert(s.removeDefault());
  if (s instanceof z.ZodNullable) {
    const inner = convert(s.unwrap());
    return { ...inner, nullable: true };
  }

  if (s instanceof z.ZodString) {
    const out: Record<string, unknown> = { type: 'string' };
    const checks = (s._def.checks ?? []) as Array<{ kind: string; value?: number }>;
    for (const c of checks) {
      if (c.kind === 'min' && typeof c.value === 'number') out.minLength = c.value;
      if (c.kind === 'max' && typeof c.value === 'number') out.maxLength = c.value;
    }
    return out;
  }
  if (s instanceof z.ZodNumber) return { type: 'number' };
  if (s instanceof z.ZodBoolean) return { type: 'boolean' };
  if (s instanceof z.ZodEnum) return { type: 'string', enum: [...s.options] };
  if (s instanceof z.ZodLiteral) return { const: s.value };

  if (s instanceof z.ZodArray) {
    const out: Record<string, unknown> = { type: 'array', items: convert(s.element) };
    const def = s._def;
    if (def.minLength != null) out.minItems = def.minLength.value;
    if (def.maxLength != null) out.maxItems = def.maxLength.value;
    return out;
  }

  if (s instanceof z.ZodObject) {
    const shape = s.shape as Record<string, ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, child] of Object.entries(shape)) {
      properties[key] = convert(child);
      // optional 与 default 都视为可选
      const isOptional = child instanceof z.ZodOptional || child instanceof z.ZodDefault;
      if (!isOptional) required.push(key);
    }
    const out: Record<string, unknown> = { type: 'object', properties };
    if (required.length > 0) out.required = required;
    out.additionalProperties = false;
    return out;
  }

  // 兜底：未识别类型不报死，给 OpenAI 一个最宽容的描述
  return {};
}
