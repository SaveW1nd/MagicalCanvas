/**
 * credits.js — 用户态积分接口：查自己的余额与流水。
 */
import express from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getUserBalanceUnits, listLedger } from '../db/index.js';

const router = express.Router();
router.use(requireAuth);

router.get('/balance', (req, res) => {
    res.json({ balance: getUserBalanceUnits(req.user.id) / 100 });
});

router.get('/ledger', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const rows = listLedger({ userId: req.user.id, limit, offset })
        .map(r => ({ ...r, amount: r.delta / 100, balanceAfter: r.balanceAfter / 100 }));
    res.json(rows);
});

export default router;
