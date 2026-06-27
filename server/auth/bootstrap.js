/**
 * auth/bootstrap.js — first-admin bootstrap.
 *
 * On startup, if there are no users, create the initial admin:
 *  - BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD env -> use them
 *  - else create admin@local with a random password, printed once to stdout.
 *
 * Returns the bootstrap admin id (or the existing first admin's id), which
 * P1 migration uses as the owner of all pre-existing single-user data.
 */
import crypto from 'crypto';
import { countUsers, createUser, getUserByUsername, listUsers } from '../db/index.js';
import { hashPassword } from './passwords.js';

export function bootstrapAdmin() {
    if (countUsers() > 0) {
        const admin = listUsers().find(u => u.role === 'admin');
        return admin ? admin.id : null;
    }

    const username = (process.env.BOOTSTRAP_ADMIN_USERNAME || process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin').trim().split('@')[0];
    let password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    let generated = false;
    if (!password) { password = crypto.randomBytes(9).toString('base64url'); generated = true; }

    const existing = getUserByUsername(username);
    const admin = existing || createUser({
        username,
        passwordHash: hashPassword(password),
        role: 'admin',
        status: 'active',
    });

    console.log('\n========================================================');
    console.log(' [MagicalCanvas] 初始管理员已创建');
    console.log(`   用户名: ${username}`);
    if (generated) {
        console.log(`   密码(随机生成，请立即登录后修改): ${password}`);
    } else {
        console.log('   密码: 来自 BOOTSTRAP_ADMIN_PASSWORD 环境变量');
    }
    console.log('========================================================\n');

    return admin.id;
}
