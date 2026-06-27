/**
 * routes/auth.js — login / logout / refresh / me / register.
 *
 * Mounted at /api/auth. Login is rate-limited. Self-registration is gated by
 * ALLOW_SELF_REGISTER (default off — internal-team deployment).
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import {
    getUserByEmail, getUserById, createUser, recordLogin, denylistToken, publicUser, updateUser,
} from '../db/index.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../auth/tokens.js';
import { requireAuth } from '../auth/middleware.js';

const router = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20, // 20 attempts / 15min / IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '登录尝试过于频繁，请稍后再试' },
});

const ALLOW_SELF_REGISTER = String(process.env.ALLOW_SELF_REGISTER || '').toLowerCase() === 'true';

function issue(user) {
    return {
        accessToken: signAccessToken(user),
        refreshToken: signRefreshToken(user),
        user: publicUser(user),
    };
}

// POST /api/auth/login  { email, password }
router.post('/login', loginLimiter, (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: '请输入邮箱和密码' });
    const user = getUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: '邮箱或密码错误' });
    }
    if (user.status !== 'active') return res.status(403).json({ error: '账号已被禁用' });
    recordLogin(user.id);
    res.json(issue(user));
});

// POST /api/auth/refresh  { refreshToken }
router.post('/refresh', (req, res) => {
    const { refreshToken } = req.body || {};
    const payload = verifyToken(refreshToken);
    if (!payload || payload.type !== 'refresh') return res.status(401).json({ error: '刷新令牌无效' });
    const user = getUserById(payload.sub);
    if (!user || user.status !== 'active') return res.status(401).json({ error: '账号不可用' });
    res.json({ accessToken: signAccessToken(user), user: publicUser(user) });
});

// POST /api/auth/logout — denylist current access token's jti
router.post('/logout', requireAuth, (req, res) => {
    if (req.token?.jti) denylistToken(req.token.jti, req.token.exp);
    res.json({ success: true });
});

// GET /api/auth/me — current user (used on SPA mount)
router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

// POST /api/auth/change-password { currentPassword, newPassword }
router.post('/change-password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ error: '请输入当前密码和新密码' });
    if (String(newPassword).length < 8) return res.status(400).json({ error: '新密码至少 8 位' });
    const user = getUserById(req.user.id);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
        return res.status(401).json({ error: '当前密码错误' });
    }
    updateUser(user.id, { passwordHash: hashPassword(newPassword) });
    res.json({ success: true });
});

// POST /api/auth/register  { email, password, username } — gated by ALLOW_SELF_REGISTER
router.post('/register', (req, res) => {
    if (!ALLOW_SELF_REGISTER) return res.status(403).json({ error: '本站不开放自助注册，请联系管理员开通账号' });
    const { email, password, username } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: '请输入邮箱和密码' });
    if (String(password).length < 8) return res.status(400).json({ error: '密码至少 8 位' });
    if (getUserByEmail(email)) return res.status(409).json({ error: '该邮箱已注册' });
    const user = createUser({ email, username, passwordHash: hashPassword(password), role: 'user' });
    res.status(201).json(issue(user));
});

export default router;
