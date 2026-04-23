// src/routes/accountTypeRoutes.js
import express from 'express';
import AccountTypeService from '../services/AccountTypeService.js';

const router = express.Router();

const getAdminId = (req) => req.user?.userId ?? req.user?.id ?? req.body?.adminId ?? null;

// ─── GET /api/accountype ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const config = await AccountTypeService.getAccountTypesConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    console.error('GET /accountype erreur:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── POST /api/accountype/custom ─────────────────────────────────────────────
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

// ─── PATCH /api/accountype/custom/:slotId ────────────────────────────────────
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

// ─── PATCH /api/accountype/:type/reset-exclude ───────────────────────────────
router.patch('/:type/reset-exclude', async (req, res) => {
  try {
    const { type } = req.params;
    const { exclude } = req.body;

    if (typeof exclude !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: '"exclude" doit être un booléen (true ou false)'
      });
    }

    const result = await AccountTypeService.setResetExclusion(getAdminId(req), type, exclude);

    res.json({
      success: true,
      message: `Type "${type}" ${exclude ? 'exclu du' : 'inclus dans le'} reset quotidien`,
      data: result
    });

  } catch (error) {
    console.error('❌ [ROUTE] reset-exclude:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── DELETE /api/accountype/custom/:slotId ───────────────────────────────────
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

// ─── PATCH /api/accountype/:type/entry-access ────────────────────────────────
// ⚠️ DOIT être avant /:type/toggle pour éviter les conflits de routes
router.patch('/:type/entry-access', async (req, res) => {
  try {
    const accountType = req.params.type.toUpperCase();
    const { access } = req.body;

    const validValues = ['both', 'debut_only', 'fin_only'];
    if (!access || !validValues.includes(access)) {
      return res.status(400).json({
        success: false,
        message: `access doit être l'une des valeurs : ${validValues.join(', ')}`
      });
    }

    const result = await AccountTypeService.setEntryAccess(
      getAdminId(req),
      accountType,
      access
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error(`PATCH /accountype/${req.params.type}/entry-access erreur:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─── PATCH /api/accountype/:type/toggle ──────────────────────────────────────
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
// ─── PATCH /api/accountype/:type/featured ────────────────────────────────────
router.patch('/:type/featured', async (req, res) => {
  try {
    const accountType = req.params.type.toUpperCase();
    const result = await AccountTypeService.setFeaturedType(getAdminId(req), accountType);
    res.json({
      success: true,
      message: `Type vedette défini : "${result.label}"`,
      data: result
    });
  } catch (error) {
    console.error(`PATCH /accountype/${req.params.type}/featured erreur:`, error);
    res.status(400).json({ success: false, message: error.message });
  }
});
// ─── POST /api/accountype ────────────────────────────────────────────────────
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