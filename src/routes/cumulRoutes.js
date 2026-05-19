// src/routes/cumulRoutes.js
import express from 'express';
import CumulService from '../services/CumulService.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken, requireAdmin);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseAndValidateDates(start, end, res) {
  if (!start) {
    res.status(400).json({ success: false, message: 'Paramètre start requis (YYYY-MM-DD)' });
    return null;
  }
  if (!DATE_RE.test(start) || (end && !DATE_RE.test(end))) {
    res.status(400).json({ success: false, message: 'Format de date invalide (YYYY-MM-DD)' });
    return null;
  }
  const s = new Date(start);
  const e = end ? new Date(end) : new Date(start); // date unique → end = start
  if (isNaN(s) || isNaN(e)) {
    res.status(400).json({ success: false, message: 'Date invalide' });
    return null;
  }
  if (e < s) {
    res.status(400).json({ success: false, message: 'La date de fin doit être après la date de début' });
    return null;
  }
  const diffDays = (e - s) / (1000 * 60 * 60 * 24);
  if (diffDays > 365) {
    res.status(400).json({ success: false, message: 'Plage maximale : 365 jours' });
    return null;
  }
  return {
    startStr: start,
    endStr:   end ?? start,
    isUnique: !end || start === end
  };
}

// ─── F1 / F2 ─────────────────────────────────────────────────────────────────

/**
 * GET /api/cumul/f1f2/preset/:preset
 * preset: 2j | 3j | 1m | 1an
 */
router.get('/f1f2/preset/:preset', async (req, res) => {
  try {
    const { preset } = req.params;
    const allowed = ['2j', '3j', '1m', '1an'];
    if (!allowed.includes(preset)) {
      return res.status(400).json({ success: false, message: `Preset invalide. Valeurs autorisées : ${allowed.join(', ')}` });
    }
    const data = await CumulService.getCumulF1F2ByPreset(preset);
    res.json(data);
  } catch (err) {
    console.error('❌ [ROUTE] /f1f2/preset:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/cumul/f1f2?start=YYYY-MM-DD[&end=YYYY-MM-DD]
 * Si end est omis → snapshot du jour start uniquement.
 */
router.get('/f1f2', async (req, res) => {
  try {
    const parsed = parseAndValidateDates(req.query.start, req.query.end, res);
    if (!parsed) return;
    const data = await CumulService.getCumulF1F2(parsed.startStr, parsed.endStr);
    res.json(data);
  } catch (err) {
    console.error('❌ [ROUTE] /f1f2:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── TRANSFERTS INTERNATIONAUX ────────────────────────────────────────────────

/**
 * GET /api/cumul/international/preset/:preset
 * preset: 1m | 3m | 6m | 1an
 */
router.get('/international/preset/:preset', async (req, res) => {
  try {
    const { preset } = req.params;
    const allowed = ['1m', '3m', '6m', '1an'];
    if (!allowed.includes(preset)) {
      return res.status(400).json({ success: false, message: `Preset invalide. Valeurs autorisées : ${allowed.join(', ')}` });
    }
    const data = await CumulService.getCumulInternationalByPreset(preset);
    res.json(data);
  } catch (err) {
    console.error('❌ [ROUTE] /international/preset:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/cumul/international?start=YYYY-MM-DD[&end=YYYY-MM-DD]
 * Si end est omis → snapshot du jour start uniquement.
 */
router.get('/international', async (req, res) => {
  try {
    const parsed = parseAndValidateDates(req.query.start, req.query.end, res);
    if (!parsed) return;
    const data = await CumulService.getCumulInternational(parsed.startStr, parsed.endStr);
    res.json(data);
  } catch (err) {
    console.error('❌ [ROUTE] /international:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/cumul/full?start=YYYY-MM-DD[&end=YYYY-MM-DD]
 */
router.get('/full', async (req, res) => {
  try {
    const parsed = parseAndValidateDates(req.query.start, req.query.end, res);
    if (!parsed) return;
    const data = await CumulService.getFullCumul(parsed.startStr, parsed.endStr);
    res.json(data);
  } catch (err) {
    console.error('❌ [ROUTE] /full:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;