import 'server-only';

import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

export const STUDENT_SESSION_COOKIE = 'hao_student_session';
export const STUDENT_SESSION_TTL_SEC = 12 * 60 * 60;

interface StudentSessionPayload {
  sid: string;
  exp: number;
}

export function verifyStudentPassword(password: string, passwordHash: string): boolean {
  if (!passwordHash || passwordHash === 'disabled-seed-only') return false;

  const [scheme, version, salt, expectedHex] = passwordHash.split(':');
  if (scheme !== 'scrypt' || version !== 'v1' || !salt || !expectedHex) return false;

  try {
    const actual = scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function signStudentSession(studentId: string): string {
  const payload: StudentSessionPayload = {
    sid: studentId,
    exp: Math.floor(Date.now() / 1000) + STUDENT_SESSION_TTL_SEC,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyStudentSession(token: string | undefined): StudentSessionPayload | null {
  if (!token) return null;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expected = sign(encodedPayload);
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<StudentSessionPayload>;
    if (!payload.sid || typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { sid: payload.sid, exp: payload.exp };
  } catch {
    return null;
  }
}

function sign(value: string): string {
  return createHmac('sha256', readAuthSecret()).update(value).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readAuthSecret(): string {
  const secret = process.env.WEB_AUTH_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('缺少学生端鉴权 env：WEB_AUTH_SECRET 或 AUTH_SECRET');
  }
  return 'local-web-dev-secret-change-before-production';
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}
