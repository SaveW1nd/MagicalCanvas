/**
 * auth/passwords.js — bcrypt password hashing (cost 12).
 */
import bcrypt from 'bcryptjs';

const COST = 12;

export function hashPassword(plain) {
    return bcrypt.hashSync(String(plain), COST);
}

export function verifyPassword(plain, hash) {
    if (!hash) return false;
    try { return bcrypt.compareSync(String(plain), hash); } catch { return false; }
}
