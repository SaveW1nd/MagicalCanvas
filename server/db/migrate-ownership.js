/**
 * db/migrate-ownership.js — backfill ownerId on existing file-based entities (P1).
 *
 * Idempotent: only touches single-object JSON files that lack an ownerId, and
 * assigns them to the bootstrap admin so pre-auth data stays accessible to the
 * original (single) user. Safe to run on every boot.
 */
import fs from 'fs';
import path from 'path';

function backfillDir(dir, adminId) {
    if (!dir || !fs.existsSync(dir)) return 0;
    let n = 0;
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const fp = path.join(dir, f);
        try {
            const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
            if (data && typeof data === 'object' && !Array.isArray(data) && !data.ownerId) {
                data.ownerId = adminId;
                fs.writeFileSync(fp, JSON.stringify(data, null, 2));
                n++;
            }
        } catch { /* skip corrupt */ }
    }
    return n;
}

/** @param {{ adminId: string, dirs: string[] }} opts */
export function migrateOwnership({ adminId, dirs }) {
    if (!adminId || !Array.isArray(dirs)) return;
    let total = 0;
    for (const dir of dirs) total += backfillDir(dir, adminId);
    if (total) console.log(`[migrate] 已为 ${total} 个历史文件补充 ownerId=${adminId}`);
}
