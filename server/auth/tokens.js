/**
 * auth/tokens.js — JWT access + refresh tokens.
 *
 * Access token: short-lived (15m), carries sub(userId)+role+jti.
 * Refresh token: long-lived (30d), carries sub+jti+type:'refresh'.
 * Secret comes from db.getJwtSecret() (env JWT_SECRET override, else persisted).
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../db/index.js';

const ACCESS_TTL = process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TTL = process.env.JWT_REFRESH_TTL || '30d';

export function signAccessToken(user) {
    return jwt.sign(
        { role: user.role, type: 'access' },
        getJwtSecret(),
        { subject: user.id, jwtid: crypto.randomUUID(), expiresIn: ACCESS_TTL },
    );
}

export function signRefreshToken(user) {
    return jwt.sign(
        { type: 'refresh' },
        getJwtSecret(),
        { subject: user.id, jwtid: crypto.randomUUID(), expiresIn: REFRESH_TTL },
    );
}

/** Returns the decoded payload, or null if invalid/expired. */
export function verifyToken(token) {
    try { return jwt.verify(String(token || ''), getJwtSecret()); } catch { return null; }
}
