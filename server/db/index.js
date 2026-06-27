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
    -- JWT logout denylist (jti -> expiry epoch seconds)
    CREATE TABLE IF NOT EXISTS token_denylist (
        jti TEXT PRIMARY KEY,
        exp INTEGER NOT NULL
    );
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
export function getUserById(id) { return _userById.get(id); }
export function listUsers() { return _allUsers.all().map(publicUser); }

export function createUser({ email, username, passwordHash, role = 'user', status = 'active' }) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const rec = {
        id,
        email: String(email).trim().toLowerCase(),
        username: username || String(email).split('@')[0],
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
