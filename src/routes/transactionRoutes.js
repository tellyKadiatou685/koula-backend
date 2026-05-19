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
import AccountTypeService from '../services/AccountTypeService.js';

const router = express.Router();

// =====================================
// MIDDLEWARE DE VALIDATION DYNAMIQUE
// =====================================

const validateAmount = (req, res, next) => {
  const { montant } = req.body;
  if (!montant || isNaN(montant) || montant <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Montant invalide - doit être un nombre positif',
    });
  }
  next();
};

// ✅ MIDDLEWARE CORRIGÉ - Validation dynamique des types de compte
const validateAccountType = async (req, res, next) => {
  const { typeCompte, partenaireId, partenaireNom } = req.body;

  console.log('🔍 [validateAccountType] Début validation:', { typeCompte, partenaireId, partenaireNom });

  // Transactions partenaire → typeCompte non requis
  if (partenaireId || partenaireNom) {
    console.log('✅ [validateAccountType] Transaction partenaire, skip validation');
    return next();
  }

  if (!typeCompte) {
    console.log('❌ [validateAccountType] Pas de typeCompte');
    return res.status(400).json({
      success: false,
      message: 'Type de compte requis',
    });
  }

  try {
    const typeCompteUpper = typeCompte.toUpperCase();
    console.log('🔍 [validateAccountType] Vérification pour:', typeCompteUpper);
    
    // ✅ Validation dynamique via AccountTypeService
    const isValid = await AccountTypeService.isValidType(typeCompteUpper);
    console.log('🔍 [validateAccountType] isValid:', isValid);
    
    if (!isValid) {
      // Récupérer tous les types actifs pour un message d'erreur utile
      const activeTypes = await AccountTypeService.getActiveOptions();
      const activeTypeValues = activeTypes.map(t => t.value);
      console.log('🔍 [validateAccountType] Types actifs:', activeTypeValues);
      
      return res.status(400).json({
        success: false,
        message: `Type de compte invalide. Types autorisés: ${activeTypeValues.join(', ')}`,
        validTypes: activeTypeValues
      });
    }
    
    console.log('✅ [validateAccountType] Validation réussie');
    next();
    
  } catch (error) {
    console.error('❌ [validateAccountType] Erreur:', error);
    
    // Fallback: accepter AUTRES_* même en cas d'erreur
    if (typeCompte && typeCompte.toUpperCase().startsWith('AUTRES_')) {
      console.log('⚠️ [validateAccountType] Fallback: accepte AUTRES_* malgré erreur');
      return next();
    }
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la validation du type de compte',
    });
  }
};

const validateOperation = (req, res, next) => {
  const { typeOperation } = req.body;
  if (!typeOperation) {
    return res.status(400).json({
      success: false,
      message: "Type d'opération requis",
    });
  }
  next();
};

// =====================================
// MISE À JOUR COMPTE SUPERVISEUR
// =====================================

router.patch(
  '/supervisors/:supervisorId/accounts/update',
  authenticateToken,
  requireAdmin,
  TransactionController.updateSupervisorAccount
);

// =====================================
// DASHBOARDS
// =====================================

router.get('/dashboard', authenticateToken, TransactionController.getDashboard);

router.get(
  '/dashboard/dates/available',
  authenticateToken,
  TransactionController.getAvailableDates
);

router.post(
  '/dashboard/test-date-filter',
  authenticateToken,
  TransactionController.testDateFilter
);

router.get(
  '/dashboard/admin',
  authenticateToken,
  requireAdmin,
  TransactionController.getAdminDashboard
);

router.get(
  '/dashboard/supervisor/:supervisorId?',
  authenticateToken,
  requireSupervisorOrAdmin,
  TransactionController.getSupervisorDashboard
);

router.get(
  '/dashboard/partner',
  authenticateToken,
  requirePartner,
  TransactionController.getPartnerDashboard
);

// =====================================
// CRÉATION DE TRANSACTIONS
// =====================================

router.post(
  '/create',
  authenticateToken,
  validateAmount,
  validateAccountType,
  validateOperation,
  TransactionController.createTransaction
);

router.post(
  '/admin/create',
  authenticateToken,
  requireAdmin,
  validateAmount,
  validateAccountType,
  validateOperation,
  TransactionController.createAdminTransaction
);

// =====================================
// UTILITAIRES
// =====================================

router.get('/supervisors/available', authenticateToken, async (req, res) => {
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
});

router.get(
  '/partners/active',
  authenticateToken,
  requireSupervisorOrAdmin,
  async (req, res) => {
    try {
      const partners = await prisma.user.findMany({
        where:   { role: 'PARTENAIRE', status: 'ACTIVE' },
        select:  { id: true, nomComplet: true, telephone: true },
        orderBy: { nomComplet: 'asc' },
      });
      res.json({
        success: true,
        message: 'Liste des partenaires actifs',
        data: { partners },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des partenaires',
      });
    }
  }
);

router.get(
  '/partners/frequent-free',
  authenticateToken,
  requireAdmin,
  TransactionController.getFrequentFreePartners
);

router.post(
  '/partners/convert-free',
  authenticateToken,
  requireAdmin,
  TransactionController.convertFreePartner
);

// ✅ Route des types de compte - dynamique
router.get('/account-types', authenticateToken, async (req, res) => {
  try {
    const config = await AccountTypeService.getAccountTypesConfig();
    
    const accountTypes = config.activeOptions.map(opt => {
      const icons = {
        'LIQUIDE': '💵',
        'ORANGE_MONEY': '📱',
        'WAVE': '🌊',
        'UV_MASTER': '⭐',
        'FREE_MONEY': '💸',
        'WESTERN_UNION': '🏦',
        'RIA': '💱',
        'MONEYGRAM': '💰',
        'SEDDO': '🪙',
        'VERSEMENT_BANK': '🏧',
        'AUTRES': '📦',
      };
      
      const icon = icons[opt.value] || '📦';
      
      return {
        key: opt.value,
        label: opt.label,
        icon: icon,
        isCustom: opt.value.startsWith('AUTRES_')
      };
    });
    
    res.json({ success: true, data: { accountTypes } });
  } catch (error) {
    console.error('❌ GET /account-types:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/admin/daily-transfer/status', TransactionController.getDailyTransferStatus);
router.get('/admin/transactions/archived', TransactionController.getArchivedTransactions);

// =====================================
// GESTION D'ERREURS
// =====================================
// Ajoutez cette route après les autres routes GET
// ✅ Route pour les types de compte (appelée par le frontend)
router.get('/accountype', authenticateToken, async (req, res) => {
  try {
    const AccountTypeService = (await import('../services/AccountTypeService.js')).default;
    const config = await AccountTypeService.getAccountTypesConfig();
    
    // Formater la réponse comme attendue par le frontend
    const response = {
      success: true,
      data: {
        allTypes: config.allTypes,
        activeTypes: config.activeTypes,
        activeOptions: config.activeOptions,
        customSlots: config.customSlots,
        entryAccess: config.entryAccess,
        featuredType: config.featuredType
      }
    };
    
    console.log('✅ [GET /accountype] Types retournés:', config.activeOptions.length);
    res.json(response);
  } catch (error) {
    console.error('❌ [GET /accountype] Erreur:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});
router.use((error, req, res, next) => {
  console.error('❌ Erreur transactionRoutes:', error);

  if (error.message?.includes('solde insuffisant') || error.message?.includes('Solde insuffisant'))
    return res.status(400).json({
      success: false,
      message: 'Solde insuffisant',
      code: 'INSUFFICIENT_BALANCE',
    });

  if (error.message?.includes('compte non trouvé') || error.message?.includes('Account not found'))
    return res.status(404).json({
      success: false,
      message: 'Compte non trouvé',
      code: 'ACCOUNT_NOT_FOUND',
    });

  if (error.message?.includes('Superviseur non trouvé'))
    return res.status(404).json({
      success: false,
      message: 'Superviseur non trouvé ou inactif',
      code: 'SUPERVISOR_NOT_FOUND',
    });

  if (error.code === 'P2002')
    return res.status(409).json({
      success: false,
      message: 'Conflit de données',
      code: 'DATA_CONFLICT',
    });

  if (error.code === 'P2025')
    return res.status(404).json({
      success: false,
      message: 'Enregistrement non trouvé',
      code: 'RECORD_NOT_FOUND',
    });

  if (error.message?.includes('permission') || error.message?.includes('autorisé'))
    return res.status(403).json({
      success: false,
      message: 'Permissions insuffisantes',
      code: 'INSUFFICIENT_PERMISSIONS',
    });

  res.status(500).json({
    success: false,
    message: 'Erreur interne lors de la transaction',
    code: 'TRANSACTION_ERROR',
    ...(process.env.NODE_ENV === 'development' && { details: error.message }),
  });
});

export default router;