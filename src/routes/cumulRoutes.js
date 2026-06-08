// src/routes/cumulRoutes.js
import express from 'express';
import CumulService from '../services/CumulService.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken, requireAdmin);

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
  const e = end ? new Date(end) : new Date(start);
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
  return { startStr: start, endStr: end ?? start, isUnique: !end || start === end };
}

// ─── F1 / F2 ─────────────────────────────────────────────────────────────────

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

// ─── INTERNATIONAUX ───────────────────────────────────────────────────────────

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

// ─── TOTAL GÉNÉRAL ────────────────────────────────────────────────────────────

router.get('/total-general', async (req, res) => {
  try {
    const data = await CumulService.getCumulTotalGeneral();
    res.json(data);
  } catch (err) {
    console.error('❌ [ROUTE] /total-general:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/total', async (req, res) => {
  try {
    const data = await CumulService.getCumulTotalGeneral();
    res.json(data);
  } catch (err) {
    console.error('❌ [ROUTE] /total:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── FULL ─────────────────────────────────────────────────────────────────────

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

// ════════════════════════════════════════════════════════════════════════════
// CUMUL TOTAL — OPÉRATIONS (DÉPÔT / RETRAIT / HISTORIQUE)
// ════════════════════════════════════════════════════════════════════════════

// ─── HISTORIQUE ───────────────────────────────────────────────────────────────
//
// GET /api/cumul/operations/history
//
// Query params (tous optionnels) :
//   type      — 'DEPOT' | 'RETRAIT'
//   dateDebut — YYYY-MM-DD
//   dateFin   — YYYY-MM-DD
//   page      — numéro de page (défaut 1)
//   limit     — taille de page (défaut 50, max 200)
//
// Réponse : { success, pagination, statistiques, filtresAppliques, transactions }

router.get('/operations/history', async (req, res) => {
  try {
    const { type, dateDebut, dateFin, page, limit } = req.query;

    // Validation type si fourni
    if (type && !['DEPOT', 'RETRAIT'].includes(type.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "Paramètre type invalide — valeurs acceptées : 'DEPOT', 'RETRAIT'"
      });
    }

    // Validation formats de dates si fournis
    if (dateDebut && !DATE_RE.test(dateDebut)) {
      return res.status(400).json({ success: false, message: 'Format dateDebut invalide (YYYY-MM-DD)' });
    }
    if (dateFin && !DATE_RE.test(dateFin)) {
      return res.status(400).json({ success: false, message: 'Format dateFin invalide (YYYY-MM-DD)' });
    }
    if (dateDebut && dateFin && new Date(dateFin) < new Date(dateDebut)) {
      return res.status(400).json({ success: false, message: 'dateFin doit être après dateDebut' });
    }

    const data = await CumulService.getCumulHistory({ type, dateDebut, dateFin, page, limit });
    res.json(data);
  } catch (err) {
    console.error('❌ [ROUTE] GET /operations/history:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DÉPÔT ────────────────────────────────────────────────────────────────────
//
// POST /api/cumul/operations/depot
//
// Body JSON :
//   montant     — number, requis, > 0
//   commentaire — string, optionnel, max 200 chars
//
// Réponse : { success, id, type, montant, description, commentaire, createdAt, admin, message }

router.post('/operations/depot', async (req, res) => {
  try {
    const { montant, commentaire } = req.body;
    const adminId = req.user.id;

    if (montant === undefined || montant === null || montant === '') {
      return res.status(400).json({ success: false, message: 'Le champ montant est requis' });
    }
    const m = parseFloat(montant);
    if (isNaN(m) || m <= 0) {
      return res.status(400).json({ success: false, message: 'Montant invalide — doit être un nombre positif' });
    }
    if (commentaire && typeof commentaire === 'string' && commentaire.trim().length > 200) {
      return res.status(400).json({ success: false, message: 'Commentaire trop long (max 200 caractères)' });
    }

    const data = await CumulService.createCumulDepot(adminId, m, commentaire ?? null);
    res.status(201).json(data);
  } catch (err) {
    console.error('❌ [ROUTE] POST /operations/depot:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── RETRAIT ──────────────────────────────────────────────────────────────────
//
// POST /api/cumul/operations/retrait
//
// Body JSON :
//   montant     — number, requis, > 0
//   commentaire — string, optionnel, max 200 chars
//
// Réponse : { success, id, type, montant, description, commentaire, createdAt, admin, message }

router.post('/operations/retrait', async (req, res) => {
  try {
    const { montant, commentaire } = req.body;
    const adminId = req.user.id;

    if (montant === undefined || montant === null || montant === '') {
      return res.status(400).json({ success: false, message: 'Le champ montant est requis' });
    }
    const m = parseFloat(montant);
    if (isNaN(m) || m <= 0) {
      return res.status(400).json({ success: false, message: 'Montant invalide — doit être un nombre positif' });
    }
    if (commentaire && typeof commentaire === 'string' && commentaire.trim().length > 200) {
      return res.status(400).json({ success: false, message: 'Commentaire trop long (max 200 caractères)' });
    }

    const data = await CumulService.createCumulRetrait(adminId, m, commentaire ?? null);
    res.status(201).json(data);
  } catch (err) {
    console.error('❌ [ROUTE] POST /operations/retrait:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── MODIFICATION MONTANT ─────────────────────────────────────────────────────
//
// PATCH /api/cumul/operations/:id/montant
//
// Body JSON :
//   montant — number, requis, > 0
//
// Réponse : { success, transactionId, ancienMontant, nouveauMontant, message }

router.patch('/operations/:id/montant', async (req, res) => {
  try {
    const { id }     = req.params;
    const { montant } = req.body;
    const adminId    = req.user.id;

    if (!id) {
      return res.status(400).json({ success: false, message: 'Paramètre id requis' });
    }
    if (montant === undefined || montant === null || montant === '') {
      return res.status(400).json({ success: false, message: 'Le champ montant est requis' });
    }
    const m = parseFloat(montant);
    if (isNaN(m) || m <= 0) {
      return res.status(400).json({ success: false, message: 'Montant invalide — doit être un nombre positif' });
    }

    const data = await CumulService.updateCumulOperationMontant(id, m, adminId);
    res.json(data);
  } catch (err) {
    console.error('❌ [ROUTE] PATCH /operations/:id/montant:', err);
    const status = err.message.includes('introuvable') ? 404
                 : err.message.includes('identique')   ? 400
                 : err.message.includes('supprimée')   ? 409
                 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// ─── SUPPRESSION LOGIQUE ──────────────────────────────────────────────────────
//
// DELETE /api/cumul/operations/:id
//
// Réponse : { success, transactionId, ancienMontant, type, message }

router.delete('/operations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;

    if (!id) {
      return res.status(400).json({ success: false, message: 'Paramètre id requis' });
    }

    const data = await CumulService.deleteCumulOperation(id, adminId);
    res.json(data);
  } catch (err) {
    console.error('❌ [ROUTE] DELETE /operations/:id:', err);
    const status = err.message.includes('introuvable')       ? 404
                 : err.message.includes('déjà supprimée')    ? 409
                 : err.message.includes('cumul total')       ? 403
                 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

export default router;