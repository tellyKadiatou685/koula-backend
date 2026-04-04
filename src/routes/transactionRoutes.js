// src/routes/transactionRoutes.js
import express from 'express';
import TransactionController from '../controllers/TransactionController.js';
import prisma from '../config/database.js';
import { 
  authenticateToken, 
  requireAdmin, 
  requireSupervisor, 
  requirePartner,
  requireSupervisorOrAdmin 
} from '../middleware/auth.js';

const router = express.Router();

// =====================================
// MIDDLEWARE DE VALIDATION
// =====================================

const validateAmount = (req, res, next) => {
  const { montant } = req.body;
  if (!montant || isNaN(montant) || montant <= 0) {
    return res.status(400).json({ success: false, message: 'Montant invalide - doit être un nombre positif' });
  }
  next();
};

const validateAccountType = (req, res, next) => {
  const { typeCompte, partenaireId, partenaireNom } = req.body;
  if (partenaireId || partenaireNom) return next();
  const validTypes = ['LIQUIDE', 'ORANGE_MONEY', 'WAVE', 'UV_MASTER', 'AUTRES',
                      'FREE_MONEY', 'WESTERN_UNION', 'RIA', 'MONEYGRAM'];
  if (!typeCompte || !validTypes.includes(typeCompte.toUpperCase())) {
    return res.status(400).json({ success: false, message: `Type de compte invalide. Types autorisés: ${validTypes.join(', ')}` });
  }
  next();
};

const validateOperation = (req, res, next) => {
  const { typeOperation } = req.body;
  if (!typeOperation) {
    return res.status(400).json({ success: false, message: 'Type d\'opération requis' });
  }
  next();
};

// =====================================
// MISE À JOUR COMPTE SUPERVISEUR
// =====================================

router.patch('/supervisors/:supervisorId/accounts/update',
  authenticateToken, requireAdmin,
  TransactionController.updateSupervisorAccount
);

// =====================================
// DASHBOARDS
// =====================================

router.get('/dashboard',
  authenticateToken,
  TransactionController.getDashboard
);

router.get('/dashboard/dates/available',
  authenticateToken,
  TransactionController.getAvailableDates
);

router.post('/dashboard/test-date-filter',
  authenticateToken,
  TransactionController.testDateFilter
);

router.get('/dashboard/admin',
  authenticateToken, requireAdmin,
  TransactionController.getAdminDashboard
);

router.get('/dashboard/supervisor/:supervisorId?',
  authenticateToken, requireSupervisorOrAdmin,
  TransactionController.getSupervisorDashboard
);

router.get('/dashboard/partner',
  authenticateToken, requirePartner,
  TransactionController.getPartnerDashboard
);

// =====================================
// CRÉATION DE TRANSACTIONS
// =====================================

router.post('/create',
  authenticateToken,
  validateAmount, validateAccountType, validateOperation,
  TransactionController.createTransaction
);

router.post('/admin/create',
  authenticateToken, requireAdmin,
  validateAmount, validateAccountType, validateOperation,
  TransactionController.createAdminTransaction
);

// =====================================
// UTILITAIRES
// =====================================

// ✅ FIX : était requirePartner → 403 pour l'admin
// Maintenant accessible aux partenaires ET à l'admin (formulaire transaction)
router.get('/supervisors/available',
  authenticateToken,
  async (req, res) => {
    try {
      const { role } = req.user;

      if (role === 'PARTENAIRE') {
        return TransactionController.getAvailableSupervisors(req, res);
      }

      const supervisors = await prisma.user.findMany({
        where:   { role: 'SUPERVISEUR', status: 'ACTIVE' },
        select:  { id: true, nomComplet: true, telephone: true, photo: true },
        orderBy: { nomComplet: 'asc' },
      });

      res.json({ success: true, data: supervisors });
    } catch (error) {
      console.error('❌ GET /supervisors/available:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// Partenaires actifs (pour superviseurs/admin)
router.get('/partners/active',
  authenticateToken, requireSupervisorOrAdmin,
  async (req, res) => {
    try {
      const partners = await prisma.user.findMany({
        where:   { role: 'PARTENAIRE', status: 'ACTIVE' },
        select:  { id: true, nomComplet: true, telephone: true },
        orderBy: { nomComplet: 'asc' },
      });
      res.json({ success: true, message: 'Liste des partenaires actifs', data: { partners } });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération des partenaires' });
    }
  }
);

// ← NOUVEAU : partenaires libres fréquents (suggestion de conversion)
router.get('/partners/frequent-free',
  authenticateToken, requireAdmin,
  TransactionController.getFrequentFreePartners
);

// ← NOUVEAU : convertir un partenaire libre en vrai compte
router.post('/partners/convert-free',
  authenticateToken, requireAdmin,
  TransactionController.convertFreePartner
);

// Types de comptes — statique (le détail actif/inactif est géré par /api/accountype)
router.get('/account-types',
  authenticateToken,
  (req, res) => {
    const accountTypes = [
      { key: 'LIQUIDE',       label: 'Liquide',        icon: '💵' },
      { key: 'ORANGE_MONEY',  label: 'Orange Money',   icon: '📱' },
      { key: 'WAVE',          label: 'Wave',           icon: '🌊' },
      { key: 'UV_MASTER',     label: 'UV Master',      icon: '⭐', adminOnly: true },
      { key: 'FREE_MONEY',    label: 'Free Money',     icon: '💸' },
      { key: 'WESTERN_UNION', label: 'Western Union',  icon: '🏦' },
      { key: 'RIA',           label: 'Ria',            icon: '💱' },
      { key: 'MONEYGRAM',     label: 'MoneyGram',      icon: '💰' },
      { key: 'AUTRES',        label: 'Autres',         icon: '📦' },
    ];
    const filtered = req.user.role !== 'ADMIN'
      ? accountTypes.filter(t => !t.adminOnly)
      : accountTypes;
    res.json({ success: true, data: { accountTypes: filtered } });
  }
);

router.get('/admin/daily-transfer/status', TransactionController.getDailyTransferStatus);
router.get('/admin/transactions/archived', TransactionController.getArchivedTransactions);

// =====================================
// GESTION D'ERREURS
// =====================================

router.use((error, req, res, next) => {
  console.error('❌ Erreur transactionRoutes:', error);

  if (error.message?.includes('solde insuffisant') || error.message?.includes('Solde insuffisant'))
    return res.status(400).json({ success: false, message: 'Solde insuffisant', code: 'INSUFFICIENT_BALANCE' });

  if (error.message?.includes('compte non trouvé') || error.message?.includes('Account not found'))
    return res.status(404).json({ success: false, message: 'Compte non trouvé', code: 'ACCOUNT_NOT_FOUND' });

  if (error.message?.includes('Superviseur non trouvé'))
    return res.status(404).json({ success: false, message: 'Superviseur non trouvé ou inactif', code: 'SUPERVISOR_NOT_FOUND' });

  if (error.code === 'P2002')
    return res.status(409).json({ success: false, message: 'Conflit de données', code: 'DATA_CONFLICT' });

  if (error.code === 'P2025')
    return res.status(404).json({ success: false, message: 'Enregistrement non trouvé', code: 'RECORD_NOT_FOUND' });

  if (error.message?.includes('permission') || error.message?.includes('autorisé'))
    return res.status(403).json({ success: false, message: 'Permissions insuffisantes', code: 'INSUFFICIENT_PERMISSIONS' });

  res.status(500).json({
    success: false,
    message: 'Erreur interne lors de la transaction',
    code: 'TRANSACTION_ERROR',
    ...(process.env.NODE_ENV === 'development' && { details: error.message }),
  });
});

export default router;