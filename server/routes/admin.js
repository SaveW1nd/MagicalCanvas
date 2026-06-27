/**
 * routes/admin.js — admin-only management API (mounted at /api/admin).
 *
 * P3 (this increment): user management. Model registry + cross-user history
 * endpoints land in later increments under the same requireAdmin guard.
 */
import express from 'express';
import {
    listUsers, getUserById, getUserByUsername, createUser, updateUser, deleteUser,
    countActiveAdmins, publicUser,
} from '../db/index.js';

const DEFAULT_PASSWORD = '12345678';
import { hashPassword } from '../auth/passwords.js';
import { requireAdmin } from '../auth/middleware.js';

const router = express.Router();
router.use(requireAdmin);

// --- Users ---
router.get('/users', (_req, res) => {
    res.json({ users: listUsers() });
});

router.post('/users', (req, res) => {
    const { username, password, role } = req.body || {};
    if (!username || !String(username).trim()) return res.status(400).json({ error: '请输入用户名' });
    // 密码留空 → 用默认密码 12345678；若填了则至少 8 位
    if (password && String(password).length < 8) return res.status(400).json({ error: '密码至少 8 位' });
    const pw = password && String(password) ? String(password) : DEFAULT_PASSWORD;
    if (getUserByUsername(username)) return res.status(409).json({ error: '该用户名已存在' });
    const u = createUser({
        username: String(username).trim(),
        passwordHash: hashPassword(pw),
        role: role === 'admin' ? 'admin' : 'user',
    });
    res.status(201).json({ user: publicUser(u), defaultPassword: password ? undefined : DEFAULT_PASSWORD });
});

router.put('/users/:id', (req, res) => {
    const u = getUserById(req.params.id);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    const { username, role, status } = req.body || {};
    const fields = {};
    if (username !== undefined) fields.username = String(username).slice(0, 40);
    if (role !== undefined) fields.role = role === 'admin' ? 'admin' : 'user';
    if (status !== undefined) fields.status = status === 'disabled' ? 'disabled' : 'active';
    // 防止移除最后一个在用管理员（降级或禁用）
    const removesAdmin =
        (fields.role && fields.role !== 'admin' && u.role === 'admin') ||
        (fields.status === 'disabled' && u.role === 'admin' && u.status === 'active');
    if (removesAdmin && countActiveAdmins() <= 1) {
        return res.status(400).json({ error: '不能移除最后一个管理员' });
    }
    res.json({ user: publicUser(updateUser(req.params.id, fields)) });
});

router.post('/users/:id/reset-password', (req, res) => {
    const u = getUserById(req.params.id);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: '新密码至少 8 位' });
    updateUser(req.params.id, { passwordHash: hashPassword(newPassword) });
    res.json({ success: true });
});

router.delete('/users/:id', (req, res) => {
    const u = getUserById(req.params.id);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    if (req.user.id === req.params.id) return res.status(400).json({ error: '不能删除自己' });
    if (u.role === 'admin' && countActiveAdmins() <= 1) return res.status(400).json({ error: '不能删除最后一个管理员' });
    deleteUser(req.params.id);
    res.json({ success: true });
});

export default router;
