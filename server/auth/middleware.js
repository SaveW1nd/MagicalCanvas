/**
 * auth/middleware.js — Express auth guards.
 *
 * requireAuth   : valid Bearer access token (not denylisted) + active user -> req.user
 * requireAdmin  : requireAuth + role === 'admin'
 * optionalAuth  : populate req.user if a valid token is present, else continue
 */
import { verifyToken } from './tokens.js';
import { getUserById, isDenylisted, publicUser } from '../db/index.js';

function bearer(req) {
    const h = req.headers.authorization || req.headers.Authorization || '';
    if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim();
    // SSE / download fallbacks may pass token via query (?access_token=)
    if (req.query && typeof req.query.access_token === 'string') return req.query.access_token;
    return null;
}

function resolve(req) {
    const token = bearer(req);
    if (!token) return { error: 'missing_token' };
    const payload = verifyToken(token);
    if (!payload || payload.type !== 'access') return { error: 'invalid_token' };
    if (isDenylisted(payload.jti)) return { error: 'revoked_token' };
    const user = getUserById(payload.sub);
    if (!user) return { error: 'user_not_found' };
    if (user.status !== 'active') return { error: 'user_disabled' };
    return { user: publicUser(user), jti: payload.jti, exp: payload.exp };
}

export function requireAuth(req, res, next) {
    const r = resolve(req);
    if (r.error) return res.status(401).json({ error: '未登录或登录已失效', code: r.error });
    req.user = r.user;
    req.token = { jti: r.jti, exp: r.exp };
    next();
}

export function requireAdmin(req, res, next) {
    const r = resolve(req);
    if (r.error) return res.status(401).json({ error: '未登录或登录已失效', code: r.error });
    if (r.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
    req.user = r.user;
    req.token = { jti: r.jti, exp: r.exp };
    next();
}

export function optionalAuth(req, _res, next) {
    const r = resolve(req);
    if (!r.error) { req.user = r.user; req.token = { jti: r.jti, exp: r.exp }; }
    next();
}
