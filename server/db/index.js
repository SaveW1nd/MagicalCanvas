/**
 * db/index.js
 *
 * SQLite (better-sqlite3) layer for the multi-tenant user/admin system.
 * Stores users, a JWT logout denylist, and a small key/value meta table
 * (schema version, generated JWT secret). Large blobs (workflows, media)
 * stay on the filesystem — this DB only holds auth/metadata.
 *
 * Access is funnelled through the repo functions exported here so a future
 * swap to Postgres stays contained to this module.
 */

import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { CONFIG_PATH } from '../config.js';

const DB_PATH = process.env.MC_DB_PATH || path.join(path.dirname(CONFIG_PATH), 'magicalcanvas.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Migrations (idempotent) — run BEFORE any db.prepare() so tables exist.
// ---------------------------------------------------------------------------
db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT
    );
    CREATE TABLE IF NOT EXISTS users (
        id           TEXT PRIMARY KEY,
        email        TEXT UNIQUE NOT NULL,
        username     TEXT,
        passwordHash TEXT NOT NULL,
        role         TEXT NOT NULL DEFAULT 'user',
        status       TEXT NOT NULL DEFAULT 'active',
        createdAt    TEXT NOT NULL,
        updatedAt    TEXT NOT NULL,
        lastLoginAt  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
    -- JWT logout denylist (jti -> expiry epoch seconds)
    CREATE TABLE IF NOT EXISTS token_denylist (
        jti TEXT PRIMARY KEY,
        exp INTEGER NOT NULL
    );
`);

// --- 积分系统：users.balance 迁移 + 流水表（单位=百分单位整数，1 积分 = 100）---
const _userCols = db.prepare(`PRAGMA table_info(users)`).all();
if (!_userCols.some(c => c.name === 'balance')) {
    db.exec(`ALTER TABLE users ADD COLUMN balance INTEGER NOT NULL DEFAULT 0`);
}
db.exec(`
    CREATE TABLE IF NOT EXISTS credit_ledger (
        id           TEXT PRIMARY KEY,
        userId       TEXT NOT NULL,
        delta        INTEGER NOT NULL,
        balanceAfter INTEGER NOT NULL,
        type         TEXT NOT NULL,
        category     TEXT,
        modelId      TEXT,
        params       TEXT,
        refId        TEXT,
        note         TEXT,
        operatorId   TEXT,
        createdAt    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_user ON credit_ledger(userId, createdAt);
`);

// ---------------------------------------------------------------------------
// meta key/value
// ---------------------------------------------------------------------------
const _getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
const _setMeta = db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
export function getMeta(key) { const r = _getMeta.get(key); return r ? r.value : null; }
export function setMeta(key, value) { _setMeta.run(key, String(value)); }

/** Returns a stable JWT secret: env override, else generate-and-persist once. */
export function getJwtSecret() {
    if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
    let s = getMeta('jwt_secret');
    if (!s) { s = crypto.randomBytes(48).toString('hex'); setMeta('jwt_secret', s); }
    return s;
}

// ---------------------------------------------------------------------------
// users repo
// ---------------------------------------------------------------------------
const _insertUser = db.prepare(`
    INSERT INTO users(id, email, username, passwordHash, role, status, createdAt, updatedAt)
    VALUES(@id, @email, @username, @passwordHash, @role, @status, @createdAt, @updatedAt)
`);
const _userByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const _userByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const _userById = db.prepare('SELECT * FROM users WHERE id = ?');
const _allUsers = db.prepare('SELECT * FROM users ORDER BY createdAt ASC');
const _countUsers = db.prepare('SELECT COUNT(*) AS n FROM users');
const _touchLogin = db.prepare('UPDATE users SET lastLoginAt = ?, updatedAt = ? WHERE id = ?');

/** Strip secrets before returning a user to any caller. */
export function publicUser(u) {
    if (!u) return null;
    const { passwordHash, ...rest } = u;
    return rest;
}

export function countUsers() { return _countUsers.get().n; }
export function getUserByEmail(email) { return _userByEmail.get(String(email || '').trim().toLowerCase()); }
export function getUserByUsername(username) { return _userByUsername.get(String(username || '').trim()); }
export function getUserById(id) { return _userById.get(id); }
export function listUsers() { return _allUsers.all().map(publicUser); }

export function createUser({ email, username, passwordHash, role = 'user', status = 'active' }) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    // 登录用 username（唯一）；email 可选，缺省按用户名生成占位以满足非空唯一约束
    const uname = String(username || '').trim() || String(email || '').split('@')[0];
    const mail = String(email || '').trim().toLowerCase() || `${uname.toLowerCase()}@local`;
    const rec = {
        id,
        email: mail,
        username: uname,
        passwordHash,
        role,
        status,
        createdAt: now,
        updatedAt: now,
    };
    _insertUser.run(rec);
    return getUserById(id);
}

export function updateUser(id, fields) {
    const allowed = ['username', 'role', 'status', 'passwordHash'];
    const sets = [];
    const vals = {};
    for (const k of allowed) {
        if (k in fields) { sets.push(`${k} = @${k}`); vals[k] = fields[k]; }
    }
    if (!sets.length) return getUserById(id);
    vals.id = id;
    vals.updatedAt = new Date().toISOString();
    db.prepare(`UPDATE users SET ${sets.join(', ')}, updatedAt = @updatedAt WHERE id = @id`).run(vals);
    return getUserById(id);
}

export function recordLogin(id) {
    const now = new Date().toISOString();
    _touchLogin.run(now, now, id);
}

const _deleteUser = db.prepare('DELETE FROM users WHERE id = ?');
const _countActiveAdmins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'");
export function deleteUser(id) { _deleteUser.run(id); }
export function countActiveAdmins() { return _countActiveAdmins.get().n; }

// ---------------------------------------------------------------------------
// 积分余额（units = 百分单位整数）+ 流水
// ---------------------------------------------------------------------------
const _getBalance = db.prepare('SELECT balance FROM users WHERE id = ?');
export function getUserBalanceUnits(id) { const r = _getBalance.get(id); return r ? r.balance : 0; }

const _addBalance = db.prepare('UPDATE users SET balance = balance + ?, updatedAt = ? WHERE id = ?');
const _setBalance = db.prepare('UPDATE users SET balance = ?, updatedAt = ? WHERE id = ?');
/** 增量改余额（正=加，负=扣），返回改后余额。 */
export function addUserBalanceUnits(id, deltaUnits) {
    _addBalance.run(deltaUnits, new Date().toISOString(), id);
    return getUserBalanceUnits(id);
}
export function setUserBalanceUnits(id, units) {
    _setBalance.run(units, new Date().toISOString(), id);
    return units;
}

const _insLedger = db.prepare(`
    INSERT INTO credit_ledger(id, userId, delta, balanceAfter, type, category, modelId, params, refId, note, operatorId, createdAt)
    VALUES(@id, @userId, @delta, @balanceAfter, @type, @category, @modelId, @params, @refId, @note, @operatorId, @createdAt)
`);
export function insertLedger(row) {
    _insLedger.run({
        id: crypto.randomUUID(),
        category: null, modelId: null, params: null, refId: null, note: null, operatorId: null,
        ...row,
        createdAt: new Date().toISOString(),
    });
}
export function listLedger({ userId, type, limit = 50, offset = 0 } = {}) {
    const where = [], args = [];
    if (userId) { where.push('userId = ?'); args.push(userId); }
    if (type) { where.push('type = ?'); args.push(type); }
    const sql = `SELECT * FROM credit_ledger ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY createdAt DESC LIMIT ? OFFSET ?`;
    return db.prepare(sql).all(...args, limit, offset);
}

// ---------------------------------------------------------------------------
// token denylist (logout)
// ---------------------------------------------------------------------------
const _denyAdd = db.prepare('INSERT OR IGNORE INTO token_denylist(jti, exp) VALUES(?, ?)');
const _denyHas = db.prepare('SELECT 1 FROM token_denylist WHERE jti = ?');
const _denyPrune = db.prepare('DELETE FROM token_denylist WHERE exp < ?');
export function denylistToken(jti, exp) { if (jti) _denyAdd.run(jti, exp || 0); }
export function isDenylisted(jti) { return !!(jti && _denyHas.get(jti)); }
export function pruneDenylist() { _denyPrune.run(Math.floor(Date.now() / 1000)); }

setMeta('schema_version', '1');
pruneDenylist();

export { db, DB_PATH };
