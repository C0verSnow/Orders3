import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '../utils/errors.ts';

function equal(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export class Sessions {
  token: string;
  sessions = new Map<string, number>();
  origin = '';
  constructor(token?: string) {
    if (token !== undefined && (token.length < 32 || token.length > 512 || !/^[!-~]+$/.test(token))) throw new AppError('ORDERS_ACCESS_TOKEN 须为 32 至 512 位无空格文本');
    this.token = token || randomBytes(32).toString('base64url');
  }
  authenticated(request: FastifyRequest) {
    const bearer = request.headers.authorization;
    if (bearer?.startsWith('Bearer ') && equal(bearer.slice(7), this.token)) return true;
    const cookie = /(?:^|;\s*)orders_session=([A-Za-z0-9_-]+)/.exec(request.headers.cookie || '')?.[1];
    return !!cookie && (this.sessions.get(cookie) ?? 0) > Date.now();
  }
  sameOrigin(request: FastifyRequest, allowed: string) {
    const origin = request.headers.origin;
    if (!origin || origin !== (allowed || this.origin)) throw new AppError('请从受信任的工作台页面发起操作', 403);
  }
  create(request: FastifyRequest, reply: FastifyReply) {
    if (!request.headers.authorization?.startsWith('Bearer ') || !equal(request.headers.authorization.slice(7), this.token)) throw new AppError('登录令牌无效', 401);
    for (const [key, expires] of this.sessions) if (expires <= Date.now()) this.sessions.delete(key);
    if (this.sessions.size >= 128) throw new AppError('会话过多，请稍后再试', 429);
    const key = randomBytes(32).toString('base64url');
    this.sessions.set(key, Date.now() + 8 * 3600000);
    reply.header('Set-Cookie', `orders_session=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${this.origin.startsWith('https:') ? '; Secure' : ''}`);
    return { authenticated: true };
  }
  clear(request: FastifyRequest, reply: FastifyReply) {
    const key = /(?:^|;\s*)orders_session=([A-Za-z0-9_-]+)/.exec(request.headers.cookie || '')?.[1];
    if (key) this.sessions.delete(key);
    reply.header('Set-Cookie', 'orders_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return { authenticated: false };
  }
}
