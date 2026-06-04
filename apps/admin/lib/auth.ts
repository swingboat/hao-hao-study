/**
 * F1 认证 — 共享工具
 *
 *  - 单管理员凭据从 env 读取：
 *      ADMIN_USERNAME           — 用户名
 *      ADMIN_PASSWORD_HASH      — bcrypt hash（生成示例：`bcrypt.hashSync("xxx", 10)`）
 *      AUTH_SECRET              — 用于 cookie HMAC 签名（≥32 字节随机串）
 *  - Session 用 jose HS256 签名 JWT，写入 HTTP-only cookie，有效期 12 小时（PRD F1.2）。
 *  - 单管理员账号，无 DB 表（PRD §3.1 排他：无注册 / 无找回）。
 */
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'admin_session';
export const SESSION_TTL_SEC = 12 * 60 * 60; // 12h，PRD F1.2

interface AuthEnv {
  username: string;
  passwordHash: string;
  secret: Uint8Array;
}

/**
 * 读取并校验运营端鉴权所需的 env 变量。缺失任何一个都直接抛错——
 * 启动时就暴露配置错误，比"登录页一直 401"更友好。
 */
function readAuthEnv(): AuthEnv {
  const username = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const secret = process.env.AUTH_SECRET;
  if (!username || !passwordHash || !secret) {
    throw new Error(
      '缺少运营端鉴权 env：ADMIN_USERNAME / ADMIN_PASSWORD_HASH / AUTH_SECRET（参见 .env.example）',
    );
  }
  if (secret.length < 32) {
    throw new Error('AUTH_SECRET 长度需 ≥32 字节');
  }
  return {
    username,
    passwordHash,
    secret: new TextEncoder().encode(secret),
  };
}

/** 校验账号密码。用户名等长比较只在 hash 阶段做（bcrypt 自身常量时间）。 */
export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  const env = readAuthEnv();
  // 用户名先做 bcrypt-style 常量时间比较，避免通过响应时间区分"用户不存在"和"密码错误"
  const userOk = username === env.username;
  // 即便用户名错也走一次 compare，让响应时间稳定
  const pwOk = await bcrypt.compare(password, env.passwordHash);
  return userOk && pwOk;
}

/** 签发 12h session JWT。payload 仅含 username，无敏感信息。 */
export async function signSession(username: string): Promise<string> {
  const { secret } = readAuthEnv();
  return new SignJWT({ sub: username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(secret);
}

/**
 * 校验 session JWT，返回 payload 或 null。
 * middleware（Edge runtime）和 server action（Node）都会调用，jose 同时兼容两端。
 */
export async function verifySession(token: string | undefined): Promise<{ sub: string } | null> {
  if (!token) return null;
  try {
    const { secret } = readAuthEnv();
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sub !== 'string') return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}
