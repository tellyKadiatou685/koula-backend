// src/routes/accountTypeRoutes.js
import express from 'express';
import AccountTypeService from '../services/AccountTypeService.js';
// Décommentez quand le middleware auth est prêt :
// import { authenticateToken, requireAdmin } from '../middlewares/auth.js';

const router = express.Router();

// router.use(authenticateToken);
// router.use(requireAdmin);

// ─── Helper : récupère l'adminId sans planter si req.user absent ──────────────
const getAdminId = (req) => req.user?.userId ?? req.user?.id ?? req.body?.adminId ?? null;

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/accountype
// Retourne tous les types (fixes + slots custom) avec leur statut
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const config = await AccountTypeService.getAccountTypesConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    console.error('GET /accountype erreur:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/accountype/custom
// Ajouter un nouveau slot "Autres" personnalisé
// Body: { label: "Tigo Cash" }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/custom', async (req, res) => {
  try {
    const { label } = req.body;

    if (!label) {
      return res.status(400).json({ success: false, message: 'Le champ label est requis' });
    }

    const result = await AccountTypeService.addCustomSlot(getAdminId(req), label);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    console.error('POST /accountype/custom erreur:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/accountype/custom/:slotId
// Renommer un slot custom existant  ← FIX BUG renommage qui ne persistait pas
// Params: slotId = "AUTRES_1", "AUTRES_2"...
// Body: { label: "Nouveau nom" }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/custom/:slotId', async (req, res) => {
  try {
    const { slotId } = req.params;
    const { label } = req.body;

    if (!label) {
      return res.status(400).json({ success: false, message: 'Le champ label est requis' });
    }

    const result = await AccountTypeService.renameCustomSlot(getAdminId(req), slotId, label);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error(`PATCH /accountype/custom/${req.params.slotId} erreur:`, error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/accountype/custom/:slotId
// Supprimer un slot custom
// Params: slotId = "AUTRES_1", "AUTRES_2"...
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/custom/:slotId', async (req, res) => {
  try {
    const { slotId } = req.params;
    const result = await AccountTypeService.removeCustomSlot(getAdminId(req), slotId);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error(`DELETE /accountype/custom/${req.params.slotId} erreur:`, error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/accountype/:type/toggle
// Activer ou désactiver n'importe quel type (fixe ou custom)
// ⚠️ Cette route DOIT être après /custom/:slotId pour éviter les conflits
// Body: { isActive: true | false }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:type/toggle', async (req, res) => {
  try {
    const accountType = req.params.type.toUpperCase();
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isActive doit être un booléen (true ou false)'
      });
    }

    const result = await AccountTypeService.toggleAccountType(
      getAdminId(req),
      accountType,
      isActive
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error(`PATCH /accountype/${req.params.type}/toggle erreur:`, error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/accountype
// Reconfigurer tous les types actifs en une seule fois
// Body: { types: ["LIQUIDE", "WAVE", "AUTRES_1"] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { types } = req.body;

    if (!Array.isArray(types)) {
      return res.status(400).json({ success: false, message: 'types doit être un tableau' });
    }

    const result = await AccountTypeService.setActiveAccountTypes(getAdminId(req), types);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('POST /accountype erreur:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

export default router;