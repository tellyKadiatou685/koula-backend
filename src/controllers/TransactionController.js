// src/controllers/TransactionController.js - VERSION OPTIMISÉE
import TransactionService from '../services/TransactionService.js';
import NotificationService from '../services/NotificationService.js';
import prisma from '../config/database.js'; 

class TransactionController {
  // =====================================
  // DASHBOARDS SELON RÔLE - OPTIMISÉS
  // =====================================

  async getDashboard(req, res) {
    try {
      const user = req.user;
      const { period = 'today', date } = req.query;
  
      if (period === 'custom' && date) {
        const validation = TransactionService.validateCustomDateTime(date);
        if (!validation.valid) {
          return res.status(400).json({ success: false, message: validation.error });
        }
      }
  
      const dashboardPromise = (() => {
        switch (user.role) {
          case 'ADMIN':
            return TransactionService.getAdminDashboard(
              period === 'custom' ? 'custom' : period,
              period === 'custom' ? date : null
            );
          case 'SUPERVISEUR':
            return TransactionService.getSupervisorDashboard(
              user.id, 
              period === 'custom' ? 'custom' : period,
              period === 'custom' ? date : null
            );
          case 'PARTENAIRE':
            return TransactionService.getPartnerDashboard(
              user.id, 
              period === 'custom' ? 'custom' : period,
              period === 'custom' ? date : null
            );
          default:
            throw new Error('Rôle utilisateur non reconnu');
        }
      })();
  
      const dashboardData = await dashboardPromise;
  
      res.json({
        success: true,
        message: `Dashboard ${user.role.toLowerCase()} récupéré avec succès`,
        data: {
          userRole: user.role,
          period,
          customDate: period === 'custom' ? date : null,
          dashboard: dashboardData
        }
      });
  
    } catch (error) {
      console.error('❌ [OPTIMIZED] Erreur getDashboard:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la récupération du dashboard'
      });
    }
  }
  
  async getAdminDashboard(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });
      }
  
      const { period = 'today', date } = req.query;
  
      console.log('📊 [CONTROLLER] getAdminDashboard appelé:', { period, date });
  
      if (period === 'custom' && date) {
        const validation = TransactionService.validateCustomDateTime(date);
        if (!validation.valid) {
          return res.status(400).json({ success: false, message: validation.error });
        }
      }
  
      const dashboardData = await TransactionService.getAdminDashboard(
        period === 'custom' ? 'custom' : period,
        period === 'custom' ? date : null
      );
  
      console.log('✅ [CONTROLLER] Dashboard data reçu:', {
        period: dashboardData.period,
        customDate: dashboardData.customDate,
        supervisorCount: dashboardData.supervisorCards?.length
      });
  
      res.json({
        success: true,
        message: 'Dashboard administrateur récupéré',
        data: {
          userRole: 'ADMIN',
          period: dashboardData.period,
          customDate: dashboardData.customDate,
          dashboard: dashboardData
        }
      });
  
    } catch (error) {
      console.error('❌ [CONTROLLER] Erreur getAdminDashboard:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la récupération du dashboard admin'
      });
    }
  }
  
  async getSupervisorDashboard(req, res) {
    try {
      const supervisorId = req.params.supervisorId || req.user.id;
      const { period = 'today', date } = req.query;
  
      console.log('🔍 [SUPERVISOR DASHBOARD] Params:', {
        supervisorId,
        period,
        date,
        userId: req.user.id,
        userRole: req.user.role
      });
  
      if (req.user.role !== 'ADMIN' && req.user.id !== supervisorId) {
        return res.status(403).json({
          success: false,
          message: 'Vous ne pouvez voir que votre propre dashboard'
        });
      }
  
      if (period === 'custom' && date) {
        const validation = TransactionService.validateCustomDateTime(date);
        if (!validation.valid) {
          return res.status(400).json({ success: false, message: validation.error });
        }
      }
  
      console.log('🔍 [SUPERVISOR DASHBOARD] Appel service avec:', supervisorId, period);
  
      const dashboardData = await TransactionService.getSupervisorDashboard(
        supervisorId,
        period === 'custom' ? 'custom' : period,
        period === 'custom' ? date : null
      );
  
      console.log('✅ [SUPERVISOR DASHBOARD] Données reçues:', {
        superviseur: dashboardData?.superviseur,
        totalTransactions: dashboardData?.recentTransactions?.length,
        comptes: Object.keys(dashboardData?.comptes?.debut || {})
      });
  
      res.json({
        success: true,
        message: 'Dashboard superviseur récupéré',
        data: {
          dashboard: dashboardData,
          customDate: period === 'custom' ? date : null
        }
      });
  
    } catch (error) {
      console.error('❌ [SUPERVISOR DASHBOARD] Erreur complète:', {
        message: error.message,
        stack: error.stack,
        supervisorId: req.params.supervisorId || req.user?.id
      });
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la récupération du dashboard superviseur',
        debug: error.stack  // ← temporaire pour voir l'erreur exacte
      });
    }
  }

  async getSupervisors(req, res) {
    try {
      const supervisors = await prisma.user.findMany({
        where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
        select: { id: true, nomComplet: true, telephone: true, photo: true },
        orderBy: { nomComplet: 'asc' },
      });
      res.json({ success: true, data: supervisors });
    } catch (error) {
      console.error('❌ getSupervisors:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // 🤝 DASHBOARD PARTENAIRE SPÉCIFIQUE
  async getPartnerDashboard(req, res) {
    try {
      const partnerId = req.user.id;
      const { period = 'today' } = req.query;

      if (req.user.role !== 'PARTENAIRE') {
        return res.status(403).json({ success: false, message: 'Accès réservé aux partenaires' });
      }

      const dashboardData = await TransactionService.getPartnerDashboard(partnerId, period);

      res.json({ success: true, message: 'Dashboard partenaire récupéré', data: dashboardData });

    } catch (error) {
      console.error('❌ [OPTIMIZED] Erreur getPartnerDashboard:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la récupération du dashboard partenaire'
      });
    }
  }

  // =====================================
  // CRÉATION DE TRANSACTIONS - OPTIMISÉES
  // =====================================

  async createTransaction(req, res) {
    try {
      const user = req.user;
      const transactionData = req.body;

      if (!transactionData.montant) {
        return res.status(400).json({ success: false, message: 'Montant requis' });
      }

      const montantFloat = parseFloat(transactionData.montant);
      if (isNaN(montantFloat) || montantFloat <= 0) {
        return res.status(400).json({ success: false, message: 'Montant invalide' });
      }

      transactionData.montant = montantFloat;

      const transactionPromise = (() => {
        switch (user.role) {
          case 'ADMIN':
            return TransactionService.createAdminTransaction(user.id, transactionData);
          case 'SUPERVISEUR':
            return TransactionService.createSupervisorTransaction(user.id, transactionData);
          case 'PARTENAIRE':
            return TransactionService.createPartnerTransaction(user.id, transactionData);
          default:
            throw new Error('Rôle non autorisé pour cette action');
        }
      })();

      const result = await transactionPromise;

      res.status(201).json({ success: true, message: 'Transaction créée avec succès' });

    } catch (error) {
      console.error('❌ [OPTIMIZED] Erreur createTransaction:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la création de la transaction'
      });
    }
  }

  // 💰 TRANSACTION ADMIN - VERSION COMPLÈTE AVEC PARTENAIRE LIBRE + TÉLÉPHONE
  async createAdminTransaction(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });
      }

      const adminId = req.user.id;
      const { 
        superviseurId, 
        typeCompte, 
        typeOperation, 
        montant, 
        partenaireId,
        partenaireNom,
        telephoneLibre    // ← NOUVEAU : optionnel, partenaire libre seulement
      } = req.body;

      console.log('🔍 [CONTROLLER] Données reçues:', {
        superviseurId, typeCompte, typeOperation, montant,
        partenaireId, partenaireNom, telephoneLibre,
        hasPartenaireNom: !!partenaireNom
      });

      const validationErrors = [];
      
      if (!superviseurId) validationErrors.push('superviseurId requis');
      
      const hasPartenaireId = !!partenaireId;
      const hasPartenaireNom = !!partenaireNom;
      const isPartnerTransaction = hasPartenaireId || hasPartenaireNom;
      
      if (!isPartnerTransaction && !typeCompte) {
        validationErrors.push('typeCompte requis pour transactions début/fin journée');
      }
      
      if (hasPartenaireId && hasPartenaireNom) {
        validationErrors.push('Choisissez soit un partenaire enregistré, soit un nom libre (pas les deux)');
      }
      
      if (!typeOperation) validationErrors.push('typeOperation requis');
      if (!montant) validationErrors.push('montant requis');
      
      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Données manquantes: ' + validationErrors.join(', ')
        });
      }

      const montantFloat = parseFloat(montant);
      
      if (isNaN(montantFloat) || montantFloat <= 0) {
        return res.status(400).json({ success: false, message: 'Le montant doit être un nombre positif' });
      }

      if (!['depot', 'retrait'].includes(typeOperation)) {
        return res.status(400).json({ success: false, message: 'typeOperation doit être "depot" ou "retrait"' });
      }

      if (!isPartnerTransaction) {
        if (!typeCompte) {
          return res.status(400).json({
            success: false,
            message: 'Type de compte requis pour transactions début/fin journée'
          });
        }
        
        const validAccountTypes = ['LIQUIDE', 'ORANGE_MONEY', 'WAVE', 'UV_MASTER', 'FREE_MONEY', 'WESTERN_UNION', 'RIA', 'MONEYGRAM', 'AUTRES'];
        
        if (!validAccountTypes.includes(typeCompte.toUpperCase())) {
          return res.status(400).json({ success: false, message: 'Type de compte invalide' });
        }
      }

      console.log('✅ [CONTROLLER] Validation passée, appel service...');

      const result = await TransactionService.createAdminTransaction(adminId, {
        superviseurId,
        typeCompte: isPartnerTransaction ? null : typeCompte.toUpperCase(),
        typeOperation,
        montant: montantFloat,
        partenaireId: partenaireId || null,
        partenaireNom: partenaireNom || null,
        telephoneLibre: telephoneLibre || null   // ← NOUVEAU
      });

      const operationLabel = typeOperation === 'depot' ? 'Dépôt' : 'Retrait';
      const transactionTypeLabel = isPartnerTransaction 
        ? `${operationLabel} partenaire` 
        : `${operationLabel} journée`;

      res.status(201).json({
        success: true,
        message: `${transactionTypeLabel} créé avec succès`,
        data: {
          ...result,
          summary: {
            type: isPartnerTransaction ? 'PARTENAIRE' : 'JOURNEE',
            operation: typeOperation,
            superviseur: result.transaction.superviseurNom,
            partenaire: result.transaction.partnerName,
            montant: result.transaction.montant,
            typeCompte: isPartnerTransaction ? null : typeCompte.toUpperCase(),
            soldeApres: result.soldeActuel || null,
            isRegisteredPartner: result.transaction.isRegisteredPartner || false
          }
        }
      });

    } catch (error) {
      console.error('❌ [CONTROLLER] Erreur createAdminTransaction:', error);
      
      const errorMappings = {
        'Superviseur non trouvé': { status: 404, message: 'Superviseur non trouvé ou inactif' },
        'Partenaire non trouvé': { status: 404, message: 'Partenaire enregistré non trouvé ou inactif' },
        'Solde insuffisant': { status: 400, message: error.message },
        'Nom du partenaire invalide': { status: 400, message: error.message }
      };

      for (const [errorKey, errorResponse] of Object.entries(errorMappings)) {
        if (error.message.includes(errorKey)) {
          return res.status(errorResponse.status).json({ success: false, message: errorResponse.message });
        }
      }

      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la création de la transaction admin'
      });
    }
  }

  // ✏️ MISE À JOUR TRANSACTION - ULTRA OPTIMISÉE
  async updateTransaction(req, res) {
    console.log('🔄 [OPTIMIZED] updateTransaction démarré:', {
      transactionId: req.params.transactionId,
      updateData: req.body,
      userId: req.user.id,
      userRole: req.user.role,
      timestamp: new Date().toISOString()
    });

    try {
      const { transactionId } = req.params;
      const updateData = req.body;
      const userId = req.user.id;

      const validationErrors = [];
      if (!transactionId) validationErrors.push('ID de transaction requis');
      if (!updateData || Object.keys(updateData).length === 0) validationErrors.push('Données de mise à jour requises');
      
      if (validationErrors.length > 0) {
        return res.status(400).json({ success: false, message: validationErrors.join(', ') });
      }

      if (updateData.montant) {
        const montantFloat = parseFloat(updateData.montant);
        if (isNaN(montantFloat) || montantFloat <= 0) {
          return res.status(400).json({ success: false, message: 'Montant invalide' });
        }
        updateData.montant = montantFloat;
      }

      const result = await TransactionService.updateTransaction(transactionId, updateData, userId);

      console.log('✅ [OPTIMIZED] Transaction mise à jour avec succès');

      res.json(result);

    } catch (error) {
      console.error('❌ [OPTIMIZED] Erreur updateTransaction:', {
        error: error.message,
        transactionId: req.params.transactionId,
        updateData: req.body,
        userId: req.user?.id,
        timestamp: new Date().toISOString()
      });

      const errorStatusMap = new Map([
        [['non trouvée', 'not found'], 404],
        [['Permissions insuffisantes', 'permissions'], 403],
        [['montant', 'amount', 'validation'], 400]
      ]);

      for (const [keywords, status] of errorStatusMap) {
        if (keywords.some(keyword => error.message.includes(keyword))) {
          return res.status(status).json({ success: false, message: error.message });
        }
      }

      res.status(500).json({
        success: false,
        message: 'Erreur interne lors de la mise à jour de la transaction',
        ...(process.env.NODE_ENV === 'development' && { details: error.message })
      });
    }
  }

  // 📊 RÉCUPÉRER DÉTAILS D'UNE TRANSACTION - OPTIMISÉE
  async getTransactionDetails(req, res) {
    try {
      const { transactionId } = req.params;

      if (!transactionId) {
        return res.status(400).json({ success: false, message: 'ID de transaction requis' });
      }

      console.log('🔍 [OPTIMIZED] getTransactionDetails:', {
        transactionId, userId: req.user.id, userRole: req.user.role,
        timestamp: new Date().toISOString()
      });

      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        select: {
          id: true, type: true, montant: true, description: true,
          createdAt: true, envoyeurId: true, destinataireId: true, partenaireId: true, metadata: true,
          envoyeur:         { select: { id: true, nomComplet: true, role: true } },
          destinataire:     { select: { id: true, nomComplet: true, role: true } },
          partenaire:       { select: { id: true, nomComplet: true } },
          compteDestination:{ select: { id: true, type: true, balance: true, initialBalance: true } }
        }
      });

      if (!transaction) {
        console.log('❌ [OPTIMIZED] Transaction non trouvée:', transactionId);
        return res.status(404).json({ success: false, message: 'Transaction non trouvée' });
      }

      const userRole = req.user.role;
      const userId = req.user.id;
      
      let canView = false;
      let viewReason = '';

      if (userRole === 'ADMIN') {
        canView = true;
        viewReason = 'Admin - accès total';
      } else if (userRole === 'SUPERVISEUR') {
        canView = userId === transaction.destinataireId || 
                  userId === transaction.envoyeurId || 
                  !!transaction.partenaireId;
        viewReason = canView ? 'Superviseur - transaction autorisée' : 'Accès refusé';
      } else if (userRole === 'PARTENAIRE') {
        canView = userId === transaction.partenaireId || userId === transaction.envoyeurId;
        viewReason = canView ? 'Partenaire - sa transaction' : 'Accès refusé';
      }

      if (!canView) {
        return res.status(403).json({ success: false, message: 'Vous n\'avez pas accès à cette transaction' });
      }

      const ageInDays = Math.floor((Date.now() - new Date(transaction.createdAt)) / (1000 * 60 * 60 * 24));
      const modifiableTypes = new Set(['DEPOT', 'RETRAIT', 'DEBUT_JOURNEE', 'FIN_JOURNEE']);
      
      const permissionRules = {
        ADMIN: {
          canModify: modifiableTypes.has(transaction.type) && ageInDays <= 7,
          canDelete: modifiableTypes.has(transaction.type) && ageInDays <= 7,
          timeLimit: 7,
          restrictions: ['Admin peut modifier toutes les transactions', 'Limite de 7 jours après création']
        },
        SUPERVISEUR: {
          canModify: transaction.destinataireId === userId && modifiableTypes.has(transaction.type) && ageInDays <= 1,
          canDelete: transaction.destinataireId === userId && ['DEPOT', 'RETRAIT'].includes(transaction.type) && ageInDays <= 1,
          timeLimit: 1,
          restrictions: ['Superviseur peut modifier ses propres transactions seulement', 'Limite de 1 jour après création']
        },
        PARTENAIRE: {
          canModify: false, canDelete: false, timeLimit: 0,
          restrictions: ['Les partenaires ne peuvent pas modifier les transactions']
        }
      };

      const permissions = permissionRules[userRole] || permissionRules.PARTENAIRE;
      const convertFromInt = (value) => Number(value) / 100;

      res.json({
        success: true,
        message: 'Détails de la transaction récupérés',
        data: {
          transaction: {
            id: transaction.id, type: transaction.type,
            montant: convertFromInt(transaction.montant),
            description: transaction.description, createdAt: transaction.createdAt,
            envoyeur: transaction.envoyeur, destinataire: transaction.destinataire,
            partenaire: transaction.partenaire,
            compte: transaction.compteDestination ? {
              ...transaction.compteDestination,
              balance: convertFromInt(transaction.compteDestination.balance),
              initialBalance: convertFromInt(transaction.compteDestination.initialBalance)
            } : null,
            metadata: transaction.metadata ? JSON.parse(transaction.metadata) : null
          },
          permissions: {
            canView, canModify: permissions.canModify, canDelete: permissions.canDelete,
            userRole: req.user.role, timeLimit: `${permissions.timeLimit} jour(s)`,
            restrictions: permissions.restrictions, viewReason
          },
          ageInDays,
          rules: {
            admin: { timeLimit: 7, canModifyAll: true, canDeleteAll: true },
            superviseur: {
              timeLimit: 1, canModifyOwn: true, canDeleteOwn: 'DEPOT/RETRAIT seulement',
              restrictions: ['Seulement ses propres transactions', 'Maximum 24h après création']
            },
            partenaire: { canView: 'Ses propres transactions seulement', canModify: false, canDelete: false }
          }
        }
      });

    } catch (error) {
      console.error('❌ [OPTIMIZED] Erreur getTransactionDetails:', {
        error: error.message, transactionId: req.params.transactionId,
        userId: req.user?.id, userRole: req.user?.role
      });
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des détails de la transaction',
        debug: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // 📋 HISTORIQUE DES MODIFICATIONS - OPTIMISÉ
  async getTransactionAuditHistory(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });
      }

      const { page = 1, limit = 20, type = 'all' } = req.query;

      const whereClause = { type: { in: ['AUDIT_MODIFICATION', 'AUDIT_SUPPRESSION'] } };

      if (type === 'modifications') whereClause.type = 'AUDIT_MODIFICATION';
      else if (type === 'suppressions') whereClause.type = 'AUDIT_SUPPRESSION';

      const [auditTransactions, totalCount] = await Promise.all([
        prisma.transaction.findMany({
          where: whereClause,
          select: {
            id: true, type: true, montant: true, description: true, createdAt: true, metadata: true,
            envoyeur:    { select: { nomComplet: true } },
            destinataire:{ select: { nomComplet: true } }
          },
          orderBy: { createdAt: 'desc' },
          skip: (parseInt(page) - 1) * parseInt(limit),
          take: parseInt(limit)
        }),
        prisma.transaction.count({ where: whereClause })
      ]);

      const convertFromInt = (value) => Number(value) / 100;
      
      const formattedAudit = auditTransactions.map(audit => ({
        id: audit.id, type: audit.type, description: audit.description, createdAt: audit.createdAt,
        adminResponsable: audit.envoyeur.nomComplet,
        superviseurConcerne: audit.destinataire.nomComplet,
        montant: convertFromInt(audit.montant),
        metadata: audit.metadata ? JSON.parse(audit.metadata) : null
      }));

      res.json({
        success: true,
        message: `${auditTransactions.length} enregistrement(s) d'audit trouvé(s)`,
        data: {
          auditHistory: formattedAudit,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / parseInt(limit)),
            totalCount, limit: parseInt(limit)
          }
        }
      });

    } catch (error) {
      console.error('❌ [OPTIMIZED] Erreur getTransactionAuditHistory:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération de l\'historique d\'audit' });
    }
  }

  // 🔧 MISE À JOUR COMPTE SUPERVISEUR - ULTRA OPTIMISÉE
  async updateSupervisorAccount(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });
      }

      const { supervisorId } = req.params;
      const { accountType, accountKey, newValue } = req.body;

      const requiredFields = { accountType, accountKey, newValue };
      const missingFields = Object.entries(requiredFields)
        .filter(([key, value]) => value === undefined || value === null || value === '')
        .map(([key]) => key);

      if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Données manquantes: ${missingFields.join(', ')} requis`
        });
      }

      const newValueFloat = parseFloat(newValue);
      
      if (isNaN(newValueFloat) || newValueFloat < 0) {
        return res.status(400).json({ success: false, message: 'La valeur doit être un nombre positif' });
      }

      const supervisor = await prisma.user.findUnique({
        where: { id: supervisorId, role: 'SUPERVISEUR' },
        select: { id: true, nomComplet: true }
      });

      if (!supervisor) {
        return res.status(404).json({ success: false, message: 'Superviseur non trouvé' });
      }

      const result = await TransactionService.updateSupervisorAccount(
        supervisorId, accountType, accountKey, newValueFloat, req.user.id
      );

      res.json({
        success: true,
        message: `Compte ${accountKey} mis à jour avec succès`,
        data: {
          supervisorId, accountType, accountKey,
          oldValue: result.oldValue, newValue: result.newValue,
          updatedAt: new Date(), updatedBy: req.user.nomComplet
        }
      });

    } catch (error) {
      console.error('❌ [OPTIMIZED] Erreur updateSupervisorAccount:', error);
      res.status(500).json({ success: false, message: error.message || 'Erreur lors de la mise à jour du compte' });
    }
  }

  // 👥 SUPERVISEURS DISPONIBLES - OPTIMISÉ
  async getAvailableSupervisors(req, res) {
    try {
      if (req.user.role !== 'PARTENAIRE') {
        return res.status(403).json({ success: false, message: 'Accès réservé aux partenaires' });
      }

      const supervisors = await TransactionService.getActiveSupervisors();

      res.json({ success: true, message: 'Liste des superviseurs disponibles', data: { supervisors } });

    } catch (error) {
      console.error('❌ [OPTIMIZED] Erreur getAvailableSupervisors:', error);
      res.status(500).json({ success: false, message: error.message || 'Erreur lors de la récupération des superviseurs' });
    }
  }

  async getDailyTransferStatus(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });
      }

      const lastTransferDate = await TransactionService.getLastTransferDate();
      const today = new Date().toDateString();
      const transferDoneToday = lastTransferDate === today;

      res.json({
        success: true,
        message: 'Statut du transfert quotidien',
        data: {
          lastTransferDate, today, transferDoneToday,
          nextTransferAt: transferDoneToday ? 'Demain à 00h00' : 'En attente du prochain cycle',
          status: transferDoneToday ? 'COMPLETED' : 'PENDING'
        }
      });

    } catch (error) {
      console.error('❌ Erreur getDailyTransferStatus:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la vérification du statut' });
    }
  }

  // Voir les transactions archivées (ADMIN seulement)
  async getArchivedTransactions(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });
      }

      const { page = 1, limit = 20, dateFrom, dateTo } = req.query;

      const whereClause = { partenaireId: { not: null }, archived: true };

      if (dateFrom || dateTo) {
        whereClause.createdAt = {};
        if (dateFrom) whereClause.createdAt.gte = new Date(dateFrom);
        if (dateTo) whereClause.createdAt.lte = new Date(dateTo);
      }

      const [archivedTransactions, totalCount] = await Promise.all([
        prisma.transaction.findMany({
          where: whereClause,
          select: {
            id: true, type: true, montant: true, description: true,
            createdAt: true, archivedAt: true,
            partenaire:        { select: { nomComplet: true } },
            destinataire:      { select: { nomComplet: true } },
            compteDestination: { select: { type: true } }
          },
          orderBy: { archivedAt: 'desc' },
          skip: (parseInt(page) - 1) * parseInt(limit),
          take: parseInt(limit)
        }),
        prisma.transaction.count({ where: whereClause })
      ]);

      const convertFromInt = (value) => Number(value) / 100;

      const formattedTransactions = archivedTransactions.map(tx => ({
        id: tx.id, type: tx.type, montant: convertFromInt(tx.montant),
        description: tx.description, createdAt: tx.createdAt, archivedAt: tx.archivedAt,
        partenaire: tx.partenaire?.nomComplet,
        superviseur: tx.destinataire?.nomComplet,
        typeCompte: tx.compteDestination?.type
      }));

      res.json({
        success: true,
        message: `${archivedTransactions.length} transaction(s) archivée(s) trouvée(s)`,
        data: {
          archivedTransactions: formattedTransactions,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / parseInt(limit)),
            totalCount, limit: parseInt(limit)
          }
        }
      });

    } catch (error) {
      console.error('❌ Erreur getArchivedTransactions:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération des transactions archivées' });
    }
  }

  // Vérification du transfert quotidien
  async getDashboard(req, res) {
    try {
      const user = req.user;
      const { period = 'today' } = req.query;

      setImmediate(() => {
        TransactionService.checkAndTransferDaily().catch(error => {
          console.error('Erreur transfert quotidien automatique:', error);
        });
      });

      const dashboardPromise = (() => {
        switch (user.role) {
          case 'ADMIN':
            return TransactionService.getAdminDashboard(
              period === 'custom' ? 'custom' : period,
              period === 'custom' ? date : null
            );
          case 'SUPERVISEUR':
            return TransactionService.getSupervisorDashboard(user.id, period);
          case 'PARTENAIRE':
            return TransactionService.getPartnerDashboard(user.id, period);
          default:
            throw new Error('Rôle utilisateur non reconnu');
        }
      })();

      const dashboardData = await dashboardPromise;

      res.json({
        success: true,
        message: `Dashboard ${user.role.toLowerCase()} récupéré avec succès`,
        data: { userRole: user.role, period, dashboard: dashboardData }
      });

    } catch (error) {
      console.error('❌ Erreur getDashboard:', error);
      res.status(500).json({ success: false, message: error.message || 'Erreur lors de la récupération du dashboard' });
    }
  }

  // Dates disponibles
  async getAvailableDates(req, res) {
    try {
      const userId = req.user.role === 'SUPERVISEUR' ? req.user.id : null;
      const role = req.user.role;
      
      const dates = await TransactionService.getAvailableDates(userId, role);

      res.json({ success: true, data: { availableDates: dates, totalDates: dates.length } });

    } catch (error) {
      console.error('Erreur getAvailableDates:', error);
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération des dates disponibles' });
    }
  }

  // Test filtrage date (ADMIN seulement)
  async testDateFilter(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });
      }

      const { date } = req.body;

      if (!date) {
        return res.status(400).json({ success: false, message: 'Date requise pour le test' });
      }

      const testResult = await TransactionService.testDateFiltering(date);

      res.json({ success: !testResult.error, data: testResult });

    } catch (error) {
      console.error('Erreur testDateFilter:', error);
      res.status(500).json({ success: false, message: 'Erreur lors du test de filtrage' });
    }
  }

  // =====================================
  // PARTENAIRES LIBRES FRÉQUENTS — NOUVEAU
  // =====================================

  // 🔍 LISTE DES PARTENAIRES LIBRES FRÉQUENTS
  async getFrequentFreePartners(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });
      }

      const { superviseurId, daysBack = 3, minTransactions = 3 } = req.query;

      const partners = await TransactionService.getFrequentFreePartners(
        superviseurId || null,
        parseInt(daysBack),
        parseInt(minTransactions)
      );

      res.json({
        success: true,
        message: `${partners.length} partenaire(s) fréquent(s) détecté(s)`,
        data: {
          partners,
          config: { daysBack: parseInt(daysBack), minTransactions: parseInt(minTransactions) }
        }
      });

    } catch (error) {
      console.error('❌ getFrequentFreePartners:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // 🔄 CONVERTIR PARTENAIRE LIBRE EN VRAI COMPTE
  async convertFreePartner(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });
      }

      const { partenaireNom, telephoneLibre } = req.body;

      if (!partenaireNom || !telephoneLibre) {
        return res.status(400).json({
          success: false,
          message: 'partenaireNom et telephoneLibre sont requis'
        });
      }

      const result = await TransactionService.convertFreePartnerToAccount(
        partenaireNom,
        telephoneLibre,
        req.user.id
      );

      res.status(201).json({
        success: true,
        message: `${result.user.nomComplet} est maintenant un partenaire enregistré`,
        data: {
          user:      result.user,
          codeAcces: result.codeAcces  // ⚠️ affiché UNE seule fois — l'admin doit le noter
        }
      });

    } catch (error) {
      console.error('❌ convertFreePartner:', error);

      if (error.message.includes('déjà utilisé')) {
        return res.status(409).json({ success: false, message: error.message });
      }
      if (error.message.includes('requis') || error.message.includes('invalide')) {
        return res.status(400).json({ success: false, message: error.message });
      }

      res.status(500).json({ success: false, message: error.message });
    }
  }
}

export default new TransactionController();