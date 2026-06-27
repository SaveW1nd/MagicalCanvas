/**
 * auth/ownership.js — per-owner access checks for file-based entities (P1).
 *
 * Rule: a user may access an entity if it is theirs. Legacy entities that have
 * no ownerId yet (pre-migration safety net) are accessible to admins only.
 * The migration (db/migrate-ownership.js) backfills ownerId so this is rare.
 */

export function canAccess(ownerId, user) {
    if (!user) return false;
    if (ownerId && ownerId === user.id) return true;
    if (!ownerId && user.role === 'admin') return true;
    return false;
}
