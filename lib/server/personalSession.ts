import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

const COOKIE_NAME = 'youtube_app_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionSecret() {
  return process.env.YOUTUBE_APP_SYNC_SECRET || '';
}

function sign(payload: string) {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export function verifyPersonalPassword(candidate: unknown) {
  const expected = process.env.YOUTUBE_APP_PASSWORD || '';
  return typeof candidate === 'string' && candidate.length <= 256 && expected.length > 0 && safeEqual(candidate, expected);
}

export function createPersonalSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

export function hasValidPersonalSession(req: NextApiRequest) {
  const secret = sessionSecret();
  const token = req.cookies[COOKIE_NAME];
  if (secret.length < 32 || !token) return false;
  const [payload, signature, extra] = token.split('.');
  const expiresAt = Number(payload);
  return !extra && Number.isSafeInteger(expiresAt) && expiresAt > Date.now() / 1000 && safeEqual(signature || '', sign(payload));
}

export function setPersonalSessionCookie(res: NextApiResponse) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${createPersonalSession()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

export function clearPersonalSessionCookie(res: NextApiResponse) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

export function hasSameOrigin(req: NextApiRequest) {
  const origin = req.headers.origin;
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.headers.host;
  if (!origin || !host) return process.env.NODE_ENV !== 'production';
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
