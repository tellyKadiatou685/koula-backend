// src/controllers/AccountLineController.js
import prisma from '../config/database.js';
import NotificationService from '../services/NotificationService.js';
import { Prisma } from '@prisma/client';

// ─── HELPER : traduit les erreurs Prisma en messages lisibles ─────────────────
function parsePrismaError(error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return "Une entrée avec ces données existe déjà (contrainte d'unicité).";
      case 'P2003':
        return 'Référence invalide : un enregistrement lié est introuvable.';
      case 'P2025':
        return 'Enregistrement introuvable : il a peut-être déjà été supprimé.';
      case 'P2014':
        return 'Impossible de supprimer : des données liées existent encore.';
      case 'P2016':
        return 'Erreur de requête : paramètres incorrects.';
      case 'P2021':
        return 'Table introuvable dans la base de données.';
      case 'P2022':
        return 'Colonne introuvable dans la base de données.';
      default:
        return `Erreur base de données (${error.code}) : veuillez réessayer.`;
    }
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return 'Données invalides envoyées à la base de données.';
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return 'Impossible de se connecter à la base de données. Réessayez plus tard.';
  }
  if (error instanceof Prisma.PrismaClientRustPanicError) {
    return "Erreur interne du serveur. Veuillez contacter l'administrateur.";
  }
  return null; // pas une erreur Prisma
}

// ─── HELPER : handler d'erreur unifié pour tous les catch ────────────────────
function handleControllerError(res, error, context = '') {
  console.error(`❌ ${context}:`, error);

  // Erreur métier avec code custom (ex: CREATED_BY_ADMIN)
  if (error.code === 'CREATED_BY_ADMIN') {
    return res.status(403).json({ success: false, message: error.message, code: error.code });
  }

  // Erreurs Prisma
  const prismaMsg = parsePrismaError(error);
  if (prismaMsg) {
    return res.status(422).json({ success: false, message: prismaMsg, code: error.code || 'PRISMA_ERROR' });
  }

  // Erreurs métier connues
  if (error.message?.includes('non trouvé') || error.message?.includes('introuvable')) {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (error.message?.includes('déjà à zéro')) {
    return res.status(400).json({ success: false, message: error.message });
  }
  if (error.message?.includes('Aucune transaction')) {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (error.message?.includes('Aucun snapshot')) {
    return res.status(404).json({ success: false, message: "Aucune donnée trouvée pour cette date. Le snapshot n'existe pas encore." });
  }
  if (error.message?.includes('non supporté')) {
    return res.status(400).json({ success: false, message: error.message });
  }

  // Erreur générique
  return res.status(500).json({
    success: false,
    message: error.message || "Une erreur inattendue s'est produite. Veuillez réessayer.",
  });
}

// ─── MAPPING UNIQUE : type de compte fixe → colonnes DailySnapshot ────────────
// ⚠️ Ce mapping DOIT rester synchronisé avec le modèle `DailySnapshot` du
// schema.prisma. Chaque type de AccountTypeEnum doit avoir une entrée ici,
// sinon la modification/suppression sur une date passée échouera avec
// "Type de compte non supporté dans le snapshot".
const SNAPSHOT_FIELD_MAP = {
  debut: {
    LIQUIDE:        'liquideDebut',
    ORANGE_MONEY:   'orangeMoneyDebut',
    WAVE:           'waveDebut',
    UV_MASTER:      'uvMasterDebut',
    FREE_MONEY:     'freeMoneyDebut',
    WESTERN_UNION:  'westernUnionDebut',
    RIA:            'riaDebut',
    MONEYGRAM:      'moneygramDebut',
    SEDDO:          'seddoDebut',
    VERSEMENT_BANK: 'versementBankDebut',
    WESTERN_2:      'westernUnion2Debut',
    RIA_2:          'ria2Debut',
    AUTRES:         'autresDebut'
  },
  sortie: {
    LIQUIDE:        'liquideFin',
    ORANGE_MONEY:   'orangeMoneyFin',
    WAVE:           'waveFin',
    UV_MASTER:      'uvMasterFin',
    FREE_MONEY:     'freeMoneyFin',
    WESTERN_UNION:  'westernUnionFin',
    RIA:            'riaFin',
    MONEYGRAM:      'moneygramFin',
    SEDDO:          'seddoFin',
    VERSEMENT_BANK: 'versementBankFin',
    WESTERN_2:      'westernUnion2Fin',
    RIA_2:          'ria2Fin',
    AUTRES:         'autresFin'
  },
  // ── F2 (finSecondaire) : uniquement pertinent côté "sortie" (fin) ──
  // Miroir des colonnes ci-dessus, suffixées FinSecondaire dans le schema.
  sortieF2: {
    LIQUIDE:        'liquideFinSecondaire',
    ORANGE_MONEY:   'orangeMoneyFinSecondaire',
    WAVE:           'waveFinSecondaire',
    UV_MASTER:      'uvMasterFinSecondaire',
    FREE_MONEY:     'freeMoneyFinSecondaire',
    WESTERN_UNION:  'westernUnionFinSecondaire',
    RIA:            'riaFinSecondaire',
    MONEYGRAM:      'moneygramFinSecondaire',
    SEDDO:          'seddoFinSecondaire',
    VERSEMENT_BANK: 'versementBankFinSecondaire',
    WESTERN_2:      'westernUnion2FinSecondaire',
    RIA_2:          'ria2FinSecondaire',
    AUTRES:         'autresFinSecondaire'
  }
};

class AccountLineController {

  // =====================================
  // HELPERS DATE
  // =====================================

  getDateRange(targetDate = null) {
    const date = targetDate ? new Date(targetDate) : new Date();
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  isPastDate(targetDate) {
    if (!targetDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);
    return target < today;
  }

  // =====================================
  // HELPERS PARTENAIRE
  // =====================================

  /**
   * Cherche les transactions partenaires actives (today).
   * Inclut les transactions créées par n'importe qui (admin ou superviseur)
   * pour ce superviseur.
   */
  async findPartnerTransactionsToday(supervisorId, partnerName, transactionType) {
    const transactions = await prisma.transaction.findMany({
      where: {
        destinataireId: supervisorId,
        type: transactionType,
        OR: [{ archived: false }, { archived: null }],
        NOT: { description: { startsWith: '[SUPPRIMÉ]' } }
      },
      include: { partenaire: { select: { id: true, nomComplet: true } } },
      orderBy: { createdAt: 'desc' }
    });

    return transactions.filter(tx => {
      const name = tx.partenaire?.nomComplet || tx.partenaireNom || '';
      return name.toLowerCase() === partnerName.toLowerCase();
    });
  }

  /**
   * Cherche les transactions partenaires archivées (dates passées).
   */
  async findPartnerTransactionsPast(supervisorId, partnerName, transactionType, targetDate) {
    const { start, end } = this.getDateRange(targetDate);
    const transactions = await prisma.transaction.findMany({
      where: {
        destinataireId: supervisorId,
        type: transactionType,
        archived: true,
        createdAt: { gte: start, lte: end },
        NOT: { description: { startsWith: '[SUPPRIMÉ]' } }
      },
      include: { partenaire: { select: { id: true, nomComplet: true } } }
    });

    return transactions.filter(tx => {
      const name = tx.partenaire?.nomComplet || tx.partenaireNom || '';
      return name.toLowerCase() === partnerName.toLowerCase();
    });
  }

  /**
   * Vérifie si les transactions d'un partenaire ont été créées uniquement par un admin.
   * Retourne { byAdmin: bool, adminName: string|null }
   */
  async checkIfCreatedByAdmin(matchingTransactions) {
    if (matchingTransactions.length === 0) return { byAdmin: false, adminName: null };

    const creatorIds = [...new Set(matchingTransactions.map(tx => tx.envoyeurId).filter(Boolean))];

    const creators = await prisma.user.findMany({
      where: { id: { in: creatorIds } },
      select: { id: true, nomComplet: true, role: true }
    });

    const allByAdmin = creators.length > 0 && creators.every(c => c.role === 'ADMIN');
    const adminCreator = creators.find(c => c.role === 'ADMIN');

    return {
      byAdmin: allByAdmin,
      adminName: adminCreator?.nomComplet || null,
      hasAdminTx: creators.some(c => c.role === 'ADMIN')
    };
  }

  // =====================================
  // DELETE
  // =====================================

  deleteAccountLine = async (req, res) => {
    try {
      const { supervisorId, lineType } = req.params;
      const { accountKey, targetDate } = req.body;
      const userId = req.user.id;

      if (!accountKey)
        return res.status(400).json({ success: false, message: 'Clé de compte requise' });

      // Normaliser "fin" → "sortie"
      if (lineType === 'fin') req.params.lineType = 'sortie';
      const normalizedLineType = lineType === 'fin' ? 'sortie' : lineType;
      req.params.lineType = normalizedLineType;

      if (!['debut', 'sortie'].includes(normalizedLineType))
        return res.status(400).json({ success: false, message: 'Type de ligne invalide' });

      // Date passée → ADMIN seulement
      if (targetDate && this.isPastDate(targetDate) && req.user.role !== 'ADMIN')
        return res.status(403).json({ success: false, message: 'Seul un administrateur peut modifier des données passées' });

      const permissionCheck = await this.checkDeletePermissions(req.user, supervisorId, accountKey);
      if (!permissionCheck.allowed)
        return res.status(403).json({ success: false, message: permissionCheck.reason });

      const result = await this.executeAccountLineDeletion(
        supervisorId, lineType, accountKey, userId, targetDate || null, req.user
      );

      res.json({
        success: true,
        message: `Ligne ${accountKey} (${lineType}) supprimée avec succès`,
        data: result
      });

    } catch (error) {
      return handleControllerError(res, error, 'deleteAccountLine');
    }
  }

  checkDeletePermissions = async (user, supervisorId, accountKey) => {
    if (user.role === 'ADMIN') return { allowed: true };
    if (user.role !== 'SUPERVISEUR') return { allowed: false, reason: 'Permissions insuffisantes' };
    if (user.id !== supervisorId) return { allowed: false, reason: 'Vous ne pouvez supprimer que vos propres comptes' };
    if (accountKey === 'UV_MASTER') return { allowed: false, reason: 'Impossible de supprimer le compte UV_MASTER' };
    return { allowed: true };
  }

  executeAccountLineDeletion = async (supervisorId, lineType, accountKey, deletedBy, targetDate = null, requestUser = null) => {
    const supervisor = await prisma.user.findUnique({ where: { id: supervisorId } });
    if (!supervisor) throw new Error('Superviseur non trouvé');

    const isPast = targetDate && this.isPastDate(targetDate);
    let result = {};

    if (accountKey.startsWith('part-')) {
      if (isPast) {
        result = await this.deletePastPartnerAccountLine(supervisorId, lineType, accountKey, deletedBy, targetDate, requestUser);
      } else {
        result = await this.deletePartnerAccountLine(supervisorId, lineType, accountKey, deletedBy, requestUser);
      }
    } else {
      if (isPast) {
        result = await this.deletePastFixedAccountLine(supervisorId, lineType, accountKey, deletedBy, targetDate);
      } else {
        const account = await prisma.account.findFirst({
          where: { userId: supervisorId, type: accountKey }
        });
        if (!account) throw new Error(`Compte ${accountKey} non trouvé`);

        const oldValue = lineType === 'debut'
          ? Number(account.initialBalance) / 100
          : Number(account.balance) / 100;
        // F2 (finSecondaire) : uniquement pertinent pour la ligne "sortie" (fin)
        const oldValueF2 = lineType === 'sortie' ? Number(account.finSecondaire) / 100 : null;

        if (oldValue === 0 && (oldValueF2 === null || oldValueF2 === 0))
          throw new Error('Cette ligne est déjà à zéro, rien à supprimer');

        await prisma.account.update({
          where: { id: account.id },
          data: lineType === 'debut'
            ? { initialBalance: 0n }
            : { balance: 0n, finSecondaire: 0n } // ← F2 remis à 0 en même temps que F
        });

        await prisma.transaction.create({
          data: {
            montant: BigInt(Math.round(oldValue * 100)),
            type: 'AUDIT_SUPPRESSION',
            description: lineType === 'sortie'
              ? `Suppression ligne ${accountKey} (${lineType}) - ${oldValue} F | F2 : ${oldValueF2} F → 0 F`
              : `Suppression ligne ${accountKey} (${lineType}) - ${oldValue} F`,
            envoyeurId: deletedBy,
            destinataireId: supervisorId,
            compteDestinationId: account.id,
            metadata: JSON.stringify({
              action: 'DELETE_ACCOUNT_LINE', lineType, accountKey, oldValue,
              ...(lineType === 'sortie' && { oldValueF2, newValueF2: 0 }),
              deletedBy, deletedAt: new Date().toISOString()
            })
          }
        });

        await NotificationService.createNotification({
          userId: supervisorId,
          title: 'Ligne de compte supprimée',
          message: lineType === 'sortie'
            ? `Ligne ${accountKey} (sortie) de ${oldValue} F supprimée (F2 : ${oldValueF2} F → 0 F)`
            : `Ligne ${accountKey} (début) de ${oldValue} F supprimée`,
          type: 'AUDIT_SUPPRESSION'
        });

        result = {
          accountId: account.id, accountKey, lineType, oldValue, newValue: 0,
          ...(lineType === 'sortie' && { oldValueF2, newValueF2: 0 })
        };
      }
    }

    return { ...result, supervisor: supervisor.nomComplet, deletedAt: new Date(), auditCreated: true };
  }

  // =====================================
  // DELETE PARTENAIRE — TODAY
  // =====================================

  deletePartnerAccountLine = async (supervisorId, lineType, accountKey, deletedBy, requestUser = null) => {
    const partnerName = accountKey.replace('part-', '');
    const transactionType = lineType === 'debut' ? 'DEPOT' : 'RETRAIT';

    const matchingTransactions = await this.findPartnerTransactionsToday(supervisorId, partnerName, transactionType);

    // ── Vérification : créées par admin → superviseur ne peut pas supprimer
    if (requestUser?.role === 'SUPERVISEUR' && matchingTransactions.length > 0) {
      const { hasAdminTx, adminName } = await this.checkIfCreatedByAdmin(matchingTransactions);
      if (hasAdminTx) {
        const err = new Error(
          `Ces transactions ont été créées par un administrateur (${adminName ?? 'Admin'}).` +
          ` Veuillez contacter un administrateur pour les supprimer.`
        );
        err.code = 'CREATED_BY_ADMIN';
        throw err;
      }
    }

    const targetPartner = matchingTransactions[0]?.partenaire || null;
    const targetPartnerName = targetPartner?.nomComplet || matchingTransactions[0]?.partenaireNom || partnerName;
    const totalValue = matchingTransactions.reduce((sum, tx) => sum + Number(tx.montant), 0) / 100;

    if (matchingTransactions.length > 0) {
      await Promise.all(matchingTransactions.map(tx =>
        prisma.transaction.update({
          where: { id: tx.id },
          data: {
            description: `[SUPPRIMÉ] ${tx.description || ''}`,
            archived: true,
            archivedAt: new Date(),
            metadata: JSON.stringify({ deleted: true, deletedBy, deletedAt: new Date().toISOString(), originalDescription: tx.description })
          }
        })
      ));
    }

    await prisma.transaction.create({
      data: {
        montant: BigInt(Math.round(totalValue * 100)),
        type: 'AUDIT_SUPPRESSION',
        description: `Suppression transactions partenaire ${targetPartnerName} (${lineType}) - ${matchingTransactions.length} tx - ${totalValue} F`,
        envoyeurId: deletedBy,
        destinataireId: supervisorId,
        ...(targetPartner?.id && { partenaireId: targetPartner.id }),
        metadata: JSON.stringify({ action: 'DELETE_PARTNER_TRANSACTIONS', lineType, partnerName: targetPartnerName, transactionCount: matchingTransactions.length, totalValue, deletedBy, deletedAt: new Date().toISOString() })
      }
    });

    await NotificationService.createNotification({
      userId: supervisorId,
      title: 'Transactions partenaire supprimées',
      message: `${matchingTransactions.length} transaction(s) de ${targetPartnerName} (${totalValue} F) supprimées`,
      type: 'AUDIT_SUPPRESSION'
    });

    return { partnerName: targetPartnerName, partnerId: targetPartner?.id || null, lineType, transactionsDeleted: matchingTransactions.length, oldValue: totalValue, newValue: 0 };
  }

  // =====================================
  // DELETE PARTENAIRE — DATE PASSÉE
  // =====================================

  deletePastPartnerAccountLine = async (supervisorId, lineType, accountKey, deletedBy, targetDate, requestUser = null) => {
    const partnerName = accountKey.replace('part-', '');
    const transactionType = lineType === 'debut' ? 'DEPOT' : 'RETRAIT';

    const matchingTransactions = await this.findPartnerTransactionsPast(supervisorId, partnerName, transactionType, targetDate);

    if (matchingTransactions.length === 0)
      throw new Error(`Aucune transaction trouvée pour ${partnerName} à cette date`);

    // ── Vérification admin (date passée = admin only, mais garde le check pour cohérence)
    if (requestUser?.role === 'SUPERVISEUR') {
      const { hasAdminTx, adminName } = await this.checkIfCreatedByAdmin(matchingTransactions);
      if (hasAdminTx) {
        const err = new Error(
          `Ces transactions ont été créées par un administrateur (${adminName ?? 'Admin'}).` +
          ` Veuillez contacter un administrateur pour les supprimer.`
        );
        err.code = 'CREATED_BY_ADMIN';
        throw err;
      }
    }

    const targetPartner = matchingTransactions[0]?.partenaire || null;
    const totalValue = matchingTransactions.reduce((sum, tx) => sum + Number(tx.montant), 0) / 100;

    // Marquer [SUPPRIMÉ]
    await Promise.all(matchingTransactions.map(tx =>
      prisma.transaction.update({
        where: { id: tx.id },
        data: {
          description: `[SUPPRIMÉ] ${tx.description || ''}`,
          metadata: JSON.stringify({ deleted: true, deletedBy, deletedAt: new Date().toISOString(), originalDescription: tx.description })
        }
      })
    ));

    // Mettre à jour le DailySnapshot
    const snapshotDate = new Date(targetDate);
    snapshotDate.setHours(0, 0, 0, 0);
    const snapshot = await prisma.dailySnapshot.findUnique({
      where: { userId_date: { userId: supervisorId, date: snapshotDate } }
    });

    if (snapshot) {
      const oldDebutTotal  = Number(snapshot.debutTotal)  / 100;
      const oldSortieTotal = Number(snapshot.sortieTotal) / 100;
      const newDebutTotal  = lineType === 'debut'  ? oldDebutTotal  - totalValue : oldDebutTotal;
      const newSortieTotal = lineType === 'sortie' ? oldSortieTotal - totalValue : oldSortieTotal;
      const newGrTotal     = newSortieTotal - newDebutTotal;

      await prisma.dailySnapshot.update({
        where: { userId_date: { userId: supervisorId, date: snapshotDate } },
        data: {
          debutTotal:  BigInt(Math.round(newDebutTotal  * 100)),
          sortieTotal: BigInt(Math.round(newSortieTotal * 100)),
          grTotal:     BigInt(Math.round(newGrTotal     * 100))
        }
      });
    }

    await prisma.transaction.create({
      data: {
        montant: BigInt(Math.round(totalValue * 100)),
        type: 'AUDIT_SUPPRESSION',
        description: `Suppression partenaire passé ${partnerName} (${lineType}) du ${targetDate} - ${matchingTransactions.length} tx - ${totalValue} F`,
        envoyeurId: deletedBy,
        destinataireId: supervisorId,
        ...(targetPartner?.id && { partenaireId: targetPartner.id }),
        metadata: JSON.stringify({ action: 'DELETE_PAST_PARTNER_TRANSACTIONS', lineType, partnerName, targetDate, transactionCount: matchingTransactions.length, totalValue, deletedBy, deletedAt: new Date().toISOString() })
      }
    });

    await NotificationService.createNotification({
      userId: supervisorId,
      title: 'Transactions passées supprimées',
      message: `${matchingTransactions.length} transaction(s) de ${partnerName} du ${targetDate} (${totalValue} F) supprimées`,
      type: 'AUDIT_SUPPRESSION'
    });

    return { partnerName, partnerId: targetPartner?.id || null, lineType, targetDate, transactionsDeleted: matchingTransactions.length, oldValue: totalValue, newValue: 0, source: 'archived_transactions' };
  }

  // =====================================
  // DELETE COMPTE FIXE — DATE PASSÉE
  // =====================================

  deletePastFixedAccountLine = async (supervisorId, lineType, accountKey, deletedBy, targetDate) => {
    const snapshotDate = new Date(targetDate);
    snapshotDate.setHours(0, 0, 0, 0);

    const snapshot = await prisma.dailySnapshot.findUnique({
      where: { userId_date: { userId: supervisorId, date: snapshotDate } }
    });

    if (!snapshot) throw new Error(`Aucun snapshot trouvé pour cette date`);

    const field = SNAPSHOT_FIELD_MAP[lineType]?.[accountKey];
    if (!field) throw new Error(`Type de compte ${accountKey} non supporté dans le snapshot`);

    // F2 (finSecondaire) : uniquement pertinent côté "sortie"
    const fieldF2 = lineType === 'sortie' ? SNAPSHOT_FIELD_MAP.sortieF2[accountKey] : null;

    const oldValue = Number(snapshot[field]) / 100;
    const oldValueF2 = fieldF2 ? Number(snapshot[fieldF2]) / 100 : null;
    if (oldValue === 0 && (oldValueF2 === null || oldValueF2 === 0))
      throw new Error('Cette ligne est déjà à zéro, rien à supprimer');

    const oldDebutTotal  = Number(snapshot.debutTotal) / 100;
    const oldSortieTotal = Number(snapshot.sortieTotal) / 100;
    const newDebutTotal  = lineType === 'debut'  ? oldDebutTotal  - oldValue : oldDebutTotal;
    const newSortieTotal = lineType === 'sortie' ? oldSortieTotal - oldValue : oldSortieTotal;
    const newGrTotal     = newSortieTotal - newDebutTotal;

    await prisma.dailySnapshot.update({
      where: { userId_date: { userId: supervisorId, date: snapshotDate } },
      data: {
        [field]: 0n,
        ...(fieldF2 && { [fieldF2]: 0n }), // ← F2 remis à 0 en même temps que F
        debutTotal:  BigInt(Math.round(newDebutTotal  * 100)),
        sortieTotal: BigInt(Math.round(newSortieTotal * 100)),
        grTotal:     BigInt(Math.round(newGrTotal     * 100))
      }
    });

    await prisma.transaction.create({
      data: {
        montant: BigInt(Math.round(oldValue * 100)),
        type: 'AUDIT_SUPPRESSION',
        description: fieldF2
          ? `Suppression ligne passée ${accountKey} (${lineType}) du ${targetDate} - ${oldValue} F | F2 : ${oldValueF2} F → 0 F`
          : `Suppression ligne passée ${accountKey} (${lineType}) du ${targetDate} - ${oldValue} F`,
        envoyeurId: deletedBy,
        destinataireId: supervisorId,
        metadata: JSON.stringify({
          action: 'DELETE_PAST_ACCOUNT_LINE', lineType, accountKey, oldValue,
          ...(fieldF2 && { oldValueF2, newValueF2: 0 }),
          targetDate, deletedBy, deletedAt: new Date().toISOString()
        })
      }
    });

    await NotificationService.createNotification({
      userId: supervisorId,
      title: 'Ligne passée supprimée',
      message: fieldF2
        ? `Ligne ${accountKey} (${lineType}) du ${targetDate} : ${oldValue} F supprimée (F2 : ${oldValueF2} F → 0 F)`
        : `Ligne ${accountKey} (${lineType}) du ${targetDate} : ${oldValue} F supprimée`,
      type: 'AUDIT_SUPPRESSION'
    });

    return {
      accountKey, lineType, targetDate, oldValue, newValue: 0,
      ...(fieldF2 && { oldValueF2, newValueF2: 0 }),
      source: 'snapshot'
    };
  }

  // =====================================
  // UPDATE
  // =====================================

  updateAccountLine = async (req, res) => {
    try {
      const { supervisorId, lineType } = req.params;
      const { accountKey, newValue, newValueF2, targetDate } = req.body;
      const userId = req.user.id;

      if (!accountKey)
        return res.status(400).json({ success: false, message: 'Clé de compte requise' });
      // Normaliser "fin" → "sortie"
      if (lineType === 'fin') req.params.lineType = 'sortie';
      const normalizedLineType = lineType === 'fin' ? 'sortie' : lineType;
      req.params.lineType = normalizedLineType;

      if (!['debut', 'sortie'].includes(normalizedLineType))
        return res.status(400).json({ success: false, message: 'Type de ligne invalide' });
      if (newValue === undefined || newValue === null || newValue === '')
        return res.status(400).json({ success: false, message: 'newValue est requis' });

      const newValueFloat = parseFloat(newValue);
      if (isNaN(newValueFloat) || newValueFloat < 0)
        return res.status(400).json({ success: false, message: 'newValue doit être un nombre positif ou zéro' });

      // F2 (finSecondaire) : uniquement envoyé/valide pour la ligne "sortie"
      const hasF2Update = normalizedLineType === 'sortie' && newValueF2 !== undefined && newValueF2 !== null && newValueF2 !== '';
      let newValueF2Float = null;
      if (hasF2Update) {
        newValueF2Float = parseFloat(newValueF2);
        if (isNaN(newValueF2Float) || newValueF2Float < 0)
          return res.status(400).json({ success: false, message: 'newValueF2 doit être un nombre positif ou zéro' });
      }

      if (targetDate && this.isPastDate(targetDate) && req.user.role !== 'ADMIN')
        return res.status(403).json({ success: false, message: 'Seul un administrateur peut modifier des données passées' });

      const permissionCheck = await this.checkUpdatePermissions(req.user, supervisorId, accountKey);
      if (!permissionCheck.allowed)
        return res.status(403).json({ success: false, message: permissionCheck.reason });

      const supervisor = await prisma.user.findUnique({ where: { id: supervisorId } });
      if (!supervisor)
        return res.status(404).json({ success: false, message: 'Superviseur non trouvé' });

      const isPast = targetDate && this.isPastDate(targetDate);
      let result;

      if (accountKey.startsWith('part-')) {
        if (isPast) {
          result = await this.updatePastPartnerAccountLine(supervisorId, lineType, accountKey, newValueFloat, userId, targetDate, req.user);
        } else {
          result = await this.updatePartnerAccountLine(supervisorId, lineType, accountKey, newValueFloat, userId, req.user);
        }
      } else {
        if (isPast) {
          result = await this.updatePastFixedAccountLine(supervisorId, lineType, accountKey, newValueFloat, userId, targetDate, hasF2Update ? newValueF2Float : null);
        } else {
          const account = await prisma.account.findFirst({
            where: { userId: supervisorId, type: accountKey }
          });
          if (!account)
            return res.status(404).json({ success: false, message: `Compte ${accountKey} non trouvé` });

          const oldValue = lineType === 'debut'
            ? Number(account.initialBalance) / 100
            : Number(account.balance) / 100;
          const oldValueF2 = lineType === 'sortie' ? Number(account.finSecondaire) / 100 : null;

          const newValueCentimes = BigInt(Math.round(newValueFloat * 100));

          const updateData = lineType === 'debut'
            ? { initialBalance: newValueCentimes }
            : { balance: newValueCentimes };
          if (hasF2Update) {
            updateData.finSecondaire = BigInt(Math.round(newValueF2Float * 100)); // ← F2 modifié avec F
          }

          await prisma.account.update({
            where: { id: account.id },
            data: updateData
          });

          await prisma.transaction.create({
            data: {
              montant: BigInt(Math.abs(Math.round((newValueFloat - oldValue) * 100))),
              type: 'AUDIT_MODIFICATION',
              description: hasF2Update
                ? `Modification ${accountKey} (${lineType}) : ${oldValue} F → ${newValueFloat} F | F2 : ${oldValueF2} F → ${newValueF2Float} F`
                : `Modification ${accountKey} (${lineType}) : ${oldValue} F → ${newValueFloat} F`,
              envoyeurId: userId,
              destinataireId: supervisorId,
              compteDestinationId: account.id,
              metadata: JSON.stringify({
                action: 'UPDATE_ACCOUNT_LINE', lineType, accountKey, oldValue, newValue: newValueFloat,
                ...(hasF2Update && { oldValueF2, newValueF2: newValueF2Float }),
                updatedBy: userId, updatedByRole: req.user.role, updatedAt: new Date().toISOString()
              })
            }
          });

          await NotificationService.createNotification({
            userId: supervisorId,
            title: 'Ligne de compte modifiée',
            message: hasF2Update
              ? `${accountKey} (${lineType === 'debut' ? 'début' : 'sortie'}) : ${oldValue} F → ${newValueFloat} F | F2 : ${oldValueF2} F → ${newValueF2Float} F`
              : `${accountKey} (${lineType === 'debut' ? 'début' : 'sortie'}) : ${oldValue} F → ${newValueFloat} F`,
            type: 'AUDIT_MODIFICATION'
          });

          result = {
            accountId: account.id, accountKey, lineType, oldValue, newValue: newValueFloat,
            ...(hasF2Update && { oldValueF2, newValueF2: newValueF2Float })
          };
        }
      }

      res.json({
        success: true,
        message: `Ligne ${accountKey} (${lineType}) mise à jour avec succès`,
        data: { ...result, supervisor: supervisor.nomComplet, updatedAt: new Date(), auditCreated: true }
      });

    } catch (error) {
      return handleControllerError(res, error, 'updateAccountLine');
    }
  }

  checkUpdatePermissions = async (user, supervisorId, accountKey) => {
    if (user.role === 'ADMIN') return { allowed: true };
    if (user.role !== 'SUPERVISEUR') return { allowed: false, reason: 'Permissions insuffisantes' };
    if (user.id !== supervisorId) return { allowed: false, reason: 'Vous ne pouvez modifier que vos propres comptes' };
    if (accountKey === 'UV_MASTER') return { allowed: false, reason: 'Impossible de modifier le compte UV_MASTER' };
    return { allowed: true };
  }

  // =====================================
  // UPDATE PARTENAIRE — TODAY
  // =====================================

  updatePartnerAccountLine = async (supervisorId, lineType, accountKey, newValue, updatedBy, requestUser = null) => {
    const partnerName = accountKey.replace('part-', '');
    const transactionType = lineType === 'debut' ? 'DEPOT' : 'RETRAIT';

    const matchingTransactions = await this.findPartnerTransactionsToday(supervisorId, partnerName, transactionType);

    // ── Vérification : créées par admin → superviseur ne peut pas modifier
    if (requestUser?.role === 'SUPERVISEUR' && matchingTransactions.length > 0) {
      const { hasAdminTx, adminName } = await this.checkIfCreatedByAdmin(matchingTransactions);
      if (hasAdminTx) {
        const err = new Error(
          `Ces transactions ont été créées par un administrateur (${adminName ?? 'Admin'}).` +
          ` Veuillez contacter un administrateur pour les modifier.`
        );
        err.code = 'CREATED_BY_ADMIN';
        throw err;
      }
    }

    const targetPartner = matchingTransactions[0]?.partenaire || null;
    const oldValue = matchingTransactions.reduce((sum, tx) => sum + Number(tx.montant), 0) / 100;
    const delta = newValue - oldValue;

    // ── Ajustement réel des transactions
    if (matchingTransactions.length > 0 && delta !== 0) {
      if (newValue === 0) {
        // Suppression complète
        await Promise.all(matchingTransactions.map(tx =>
          prisma.transaction.update({
            where: { id: tx.id },
            data: {
              description: `[SUPPRIMÉ] ${tx.description || ''}`,
              archived: true,
              archivedAt: new Date(),
              metadata: JSON.stringify({ deleted: true, deletedBy: updatedBy, deletedAt: new Date().toISOString(), originalDescription: tx.description })
            }
          })
        ));
      } else if (matchingTransactions.length === 1) {
        // Une seule transaction → modifier son montant directement
        const tx = matchingTransactions[0];
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            montant: BigInt(Math.round(newValue * 100)),
            description: `${tx.description || ''} [modifié: ${oldValue} F → ${newValue} F]`.trim()
          }
        });
      } else {
        // Plusieurs transactions → ajouter une transaction de correction (delta)
        // et archiver si delta ramène à 0
        if (newValue < oldValue) {
          // Réduction : on archive les dernières jusqu'à atteindre la nouvelle valeur
          let remaining = Math.round((oldValue - newValue) * 100);
          const sorted = [...matchingTransactions].sort((a, b) =>
            new Date(b.createdAt) - new Date(a.createdAt)
          );
          for (const tx of sorted) {
            if (remaining <= 0) break;
            const txMontant = Number(tx.montant);
            if (txMontant <= remaining) {
              await prisma.transaction.update({
                where: { id: tx.id },
                data: {
                  description: `[SUPPRIMÉ] ${tx.description || ''}`,
                  archived: true,
                  archivedAt: new Date(),
                  metadata: JSON.stringify({ deleted: true, deletedBy: updatedBy, deletedAt: new Date().toISOString(), originalDescription: tx.description })
                }
              });
              remaining -= txMontant;
            } else {
              // Réduire partiellement ce tx
              await prisma.transaction.update({
                where: { id: tx.id },
                data: {
                  montant: BigInt(txMontant - remaining),
                  description: `${tx.description || ''} [modifié: réduit de ${remaining / 100} F]`.trim()
                }
              });
              remaining = 0;
            }
          }
        } else {
          // Augmentation → créer une transaction de complément
          const complement = newValue - oldValue;
          const firstTx = matchingTransactions[0];
          await prisma.transaction.create({
            data: {
              montant: BigInt(Math.round(complement * 100)),
              type: transactionType,
              description: `Complément correction partenaire ${partnerName} (${lineType})`,
              envoyeurId: updatedBy,
              destinataireId: supervisorId,
              ...(targetPartner?.id && { partenaireId: targetPartner.id }),
              ...(firstTx.partenaireNom && { partenaireNom: firstTx.partenaireNom }),
              metadata: JSON.stringify({ action: 'PARTNER_COMPLEMENT', lineType, partnerName, oldValue, newValue, updatedBy, updatedAt: new Date().toISOString() })
            }
          });
        }
      }
    } else if (matchingTransactions.length === 0 && newValue > 0) {
      // Aucune transaction existante → en créer une nouvelle
      await prisma.transaction.create({
        data: {
          montant: BigInt(Math.round(newValue * 100)),
          type: transactionType,
          description: `Ajout manuel partenaire ${partnerName} (${lineType})`,
          envoyeurId: updatedBy,
          destinataireId: supervisorId,
          ...(targetPartner?.id
            ? { partenaireId: targetPartner.id }
            : { partenaireNom: partnerName }
          ),
          metadata: JSON.stringify({ action: 'ADD_PARTNER_LINE', lineType, partnerName, newValue, updatedBy, updatedAt: new Date().toISOString() })
        }
      });
    }

    // Audit
    await prisma.transaction.create({
      data: {
        montant: BigInt(Math.abs(Math.round(delta * 100))),
        type: 'AUDIT_MODIFICATION',
        description: `Correction partenaire ${partnerName} (${lineType}) : ${oldValue} F → ${newValue} F`,
        envoyeurId: updatedBy,
        destinataireId: supervisorId,
        ...(targetPartner?.id && { partenaireId: targetPartner.id }),
        metadata: JSON.stringify({ action: 'UPDATE_ACCOUNT_LINE', lineType, accountKey, partnerName, oldValue, newValue, delta, updatedBy, updatedAt: new Date().toISOString() })
      }
    });

    await NotificationService.createNotification({
      userId: supervisorId,
      title: 'Ligne partenaire modifiée',
      message: `Partenaire ${partnerName} (${lineType === 'debut' ? 'début' : 'sortie'}) : ${oldValue} F → ${newValue} F`,
      type: 'AUDIT_MODIFICATION'
    });

    return { accountKey, lineType, partnerName, partnerId: targetPartner?.id || null, oldValue, newValue };
  }

  // =====================================
  // UPDATE PARTENAIRE — DATE PASSÉE
  // =====================================

  updatePastPartnerAccountLine = async (supervisorId, lineType, accountKey, newValue, updatedBy, targetDate, requestUser = null) => {
    const partnerName = accountKey.replace('part-', '');
    const transactionType = lineType === 'debut' ? 'DEPOT' : 'RETRAIT';

    const matching = await this.findPartnerTransactionsPast(supervisorId, partnerName, transactionType, targetDate);

    // ── Vérification admin
    if (requestUser?.role === 'SUPERVISEUR' && matching.length > 0) {
      const { hasAdminTx, adminName } = await this.checkIfCreatedByAdmin(matching);
      if (hasAdminTx) {
        const err = new Error(
          `Ces transactions ont été créées par un administrateur (${adminName ?? 'Admin'}).` +
          ` Veuillez contacter un administrateur pour les modifier.`
        );
        err.code = 'CREATED_BY_ADMIN';
        throw err;
      }
    }

    const targetPartner = matching[0]?.partenaire || null;
    const oldValue = matching.reduce((sum, tx) => sum + Number(tx.montant), 0) / 100;
    const delta = newValue - oldValue;

    // ── Ajustement réel des transactions archivées
    if (matching.length > 0 && delta !== 0) {
      if (newValue === 0) {
        await Promise.all(matching.map(tx =>
          prisma.transaction.update({
            where: { id: tx.id },
            data: {
              description: `[SUPPRIMÉ] ${tx.description || ''}`,
              metadata: JSON.stringify({ deleted: true, deletedBy: updatedBy, deletedAt: new Date().toISOString() })
            }
          })
        ));
      } else if (matching.length === 1) {
        await prisma.transaction.update({
          where: { id: matching[0].id },
          data: {
            montant: BigInt(Math.round(newValue * 100)),
            description: `${matching[0].description || ''} [modifié: ${oldValue} F → ${newValue} F]`.trim()
          }
        });
      } else {
        // Plusieurs → ajuster le plus récent, archiver les autres si nécessaire
        const sorted = [...matching].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        if (matching.length > 1) {
          // Archiver tout sauf le premier, mettre le total sur le premier
          for (let i = 1; i < sorted.length; i++) {
            await prisma.transaction.update({
              where: { id: sorted[i].id },
              data: {
                description: `[SUPPRIMÉ-MERGE] ${sorted[i].description || ''}`,
                metadata: JSON.stringify({ deleted: true, mergedBy: updatedBy, mergedAt: new Date().toISOString() })
              }
            });
          }
          await prisma.transaction.update({
            where: { id: sorted[0].id },
            data: {
              montant: BigInt(Math.round(newValue * 100)),
              description: `${sorted[0].description || ''} [modifié: ${oldValue} F → ${newValue} F]`.trim()
            }
          });
        }
      }
    } else if (matching.length === 0 && newValue > 0) {
      // Créer une transaction archivée si aucune n'existe
      const { start } = this.getDateRange(targetDate);
      await prisma.transaction.create({
        data: {
          montant: BigInt(Math.round(newValue * 100)),
          type: transactionType,
          description: `Ajout manuel partenaire ${partnerName} (${lineType}) du ${targetDate}`,
          envoyeurId: updatedBy,
          destinataireId: supervisorId,
          // ── partenaireId si compte enregistré, sinon partenaireNom pour partenaire libre
          ...(targetPartner?.id
            ? { partenaireId: targetPartner.id }
            : { partenaireNom: partnerName }
          ),
          archived: true,
          archivedAt: new Date(),
          createdAt: start,
          metadata: JSON.stringify({ action: 'ADD_PAST_PARTNER_LINE', lineType, partnerName, newValue, targetDate, updatedBy, updatedAt: new Date().toISOString() })
        }
      });
    }

    // Mettre à jour le DailySnapshot
    const snapshotDate = new Date(targetDate);
    snapshotDate.setHours(0, 0, 0, 0);
    const snapshot = await prisma.dailySnapshot.findUnique({
      where: { userId_date: { userId: supervisorId, date: snapshotDate } }
    });

    if (snapshot) {
      const oldDebutTotal  = Number(snapshot.debutTotal)  / 100;
      const oldSortieTotal = Number(snapshot.sortieTotal) / 100;
      const newDebutTotal  = lineType === 'debut'  ? oldDebutTotal  + delta : oldDebutTotal;
      const newSortieTotal = lineType === 'sortie' ? oldSortieTotal + delta : oldSortieTotal;
      const newGrTotal     = newSortieTotal - newDebutTotal;

      await prisma.dailySnapshot.update({
        where: { userId_date: { userId: supervisorId, date: snapshotDate } },
        data: {
          debutTotal:  BigInt(Math.round(newDebutTotal  * 100)),
          sortieTotal: BigInt(Math.round(newSortieTotal * 100)),
          grTotal:     BigInt(Math.round(newGrTotal     * 100))
        }
      });
    }

    await prisma.transaction.create({
      data: {
        montant: BigInt(Math.abs(Math.round(delta * 100))),
        type: 'AUDIT_MODIFICATION',
        description: `Correction partenaire passé ${partnerName} (${lineType}) du ${targetDate} : ${oldValue} F → ${newValue} F`,
        envoyeurId: updatedBy,
        destinataireId: supervisorId,
        ...(targetPartner?.id && { partenaireId: targetPartner.id }),
        metadata: JSON.stringify({ action: 'UPDATE_PAST_PARTNER_LINE', lineType, accountKey, partnerName, oldValue, newValue, delta, targetDate, updatedBy, updatedAt: new Date().toISOString() })
      }
    });

    await NotificationService.createNotification({
      userId: supervisorId,
      title: 'Ligne partenaire passée modifiée',
      message: `${partnerName} (${lineType}) du ${targetDate} : ${oldValue} F → ${newValue} F`,
      type: 'AUDIT_MODIFICATION'
    });

    return { accountKey, lineType, partnerName, partnerId: targetPartner?.id || null, oldValue, newValue, targetDate, source: 'archived_transactions' };
  }

  // =====================================
  // UPDATE COMPTE FIXE — DATE PASSÉE
  updatePastFixedAccountLine = async (supervisorId, lineType, accountKey, newValue, updatedBy, targetDate, newValueF2 = null) => {
    const snapshotDate = new Date(targetDate);
    snapshotDate.setHours(0, 0, 0, 0);

    const snapshot = await prisma.dailySnapshot.findUnique({
      where: { userId_date: { userId: supervisorId, date: snapshotDate } }
    });

    if (!snapshot) throw new Error(`Aucun snapshot trouvé pour cette date`);

    const field = SNAPSHOT_FIELD_MAP[lineType]?.[accountKey];
    if (!field) throw new Error(`Type de compte ${accountKey} non supporté dans le snapshot`);

    const fieldF2 = lineType === 'sortie' ? SNAPSHOT_FIELD_MAP.sortieF2[accountKey] : null;
    const hasF2Update = fieldF2 !== null && newValueF2 !== null && newValueF2 !== undefined;
    const oldValueF2 = fieldF2 ? Number(snapshot[fieldF2]) / 100 : null;

    const oldValue = Number(snapshot[field]) / 100;
    const delta = newValue - oldValue;

    const oldDebutTotal  = Number(snapshot.debutTotal)  / 100;
    const oldSortieTotal = Number(snapshot.sortieTotal) / 100;
    const newDebutTotal  = lineType === 'debut'  ? oldDebutTotal  + delta : oldDebutTotal;
    const newSortieTotal = lineType === 'sortie' ? oldSortieTotal + delta : oldSortieTotal;
    const newGrTotal     = newSortieTotal - newDebutTotal;

    await prisma.dailySnapshot.update({
      where: { userId_date: { userId: supervisorId, date: snapshotDate } },
      data: {
        [field]: BigInt(Math.round(newValue * 100)),
        ...(hasF2Update && { [fieldF2]: BigInt(Math.round(newValueF2 * 100)) }),
        debutTotal:  BigInt(Math.round(newDebutTotal  * 100)),
        sortieTotal: BigInt(Math.round(newSortieTotal * 100)),
        grTotal:     BigInt(Math.round(newGrTotal     * 100))
      }
    });

    // ── NOUVEAU : synchroniser la clé systemConfig snapshot_f2_*, qui est
    // la SEULE source lue par getSnapshotForDate() pour afficher F2 sur
    // les dates passées. Sans ça, l'écriture ci-dessus est invisible.
    if (hasF2Update) {
      const dateStr = snapshotDate.toISOString().split('T')[0];
      const f2Key = `snapshot_f2_${supervisorId}_${dateStr}`;
      const f2Config = await prisma.systemConfig.findFirst({ where: { key: f2Key } });
      const f2Data = f2Config?.value ? JSON.parse(f2Config.value) : {};

      const f2Centimes = Math.round(newValueF2 * 100);
      if (f2Centimes > 0) {
        f2Data[accountKey] = String(f2Centimes);
      } else {
        delete f2Data[accountKey];
      }

      await prisma.systemConfig.upsert({
        where:  { key: f2Key },
        update: { value: JSON.stringify(f2Data) },
        create: { key: f2Key, value: JSON.stringify(f2Data) }
      });
      console.log(`✅ [F2 SYNC] ${f2Key} mis à jour:`, f2Data);
    }

    await prisma.transaction.create({
      data: {
        montant: BigInt(Math.abs(Math.round(delta * 100))),
        type: 'AUDIT_MODIFICATION',
        description: hasF2Update
          ? `Modification passée ${accountKey} (${lineType}) du ${targetDate} : ${oldValue} F → ${newValue} F | F2 : ${oldValueF2} F → ${newValueF2} F`
          : `Modification passée ${accountKey} (${lineType}) du ${targetDate} : ${oldValue} F → ${newValue} F`,
        envoyeurId: updatedBy,
        destinataireId: supervisorId,
        metadata: JSON.stringify({
          action: 'UPDATE_PAST_ACCOUNT_LINE', lineType, accountKey, oldValue, newValue,
          ...(hasF2Update && { oldValueF2, newValueF2 }),
          targetDate, updatedBy, updatedAt: new Date().toISOString()
        })
      }
    });

    await NotificationService.createNotification({
      userId: supervisorId,
      title: 'Ligne passée modifiée',
      message: hasF2Update
        ? `${accountKey} (${lineType}) du ${targetDate} : ${oldValue} F → ${newValue} F | F2 : ${oldValueF2} F → ${newValueF2} F`
        : `${accountKey} (${lineType}) du ${targetDate} : ${oldValue} F → ${newValue} F`,
      type: 'AUDIT_MODIFICATION'
    });

    return {
      accountKey, lineType, targetDate, oldValue, newValue,
      ...(hasF2Update && { oldValueF2, newValueF2 }),
      source: 'snapshot'
    };
  }
  // RESET
  // =====================================

  resetAccountLine = async (req, res) => {
    try {
      const { supervisorId, lineType } = req.params;
      const { accountKey, newValue = 0, newValueF2 = 0 } = req.body;
      const userId = req.user.id;

      if (!accountKey)
        return res.status(400).json({ success: false, message: 'Clé de compte requise' });

      // Normaliser "fin" → "sortie"
      if (lineType === 'fin') req.params.lineType = 'sortie';
      const normalizedLineType = lineType === 'fin' ? 'sortie' : lineType;

      if (newValue < 0)
        return res.status(400).json({ success: false, message: 'Valeur négative non autorisée' });
      if (normalizedLineType === 'sortie' && newValueF2 < 0)
        return res.status(400).json({ success: false, message: 'Valeur F2 négative non autorisée' });

      const perm = await this.checkResetPermissions(req.user, supervisorId, accountKey);
      if (!perm.allowed)
        return res.status(403).json({ success: false, message: perm.reason });

      const supervisor = await prisma.user.findUnique({ where: { id: supervisorId } });
      if (!supervisor)
        return res.status(404).json({ success: false, message: 'Superviseur non trouvé' });

      const newValueCentimes = Math.round(newValue * 100);

      // ── Si partenaire → reset via transactions
      if (accountKey.startsWith('part-')) {
        const partnerName = accountKey.replace('part-', '');
        const transactionType = lineType === 'debut' ? 'DEPOT' : 'RETRAIT';
        const matchingTransactions = await this.findPartnerTransactionsToday(supervisorId, partnerName, transactionType);

        // Vérif admin
        if (req.user.role === 'SUPERVISEUR' && matchingTransactions.length > 0) {
          const { hasAdminTx, adminName } = await this.checkIfCreatedByAdmin(matchingTransactions);
          if (hasAdminTx) {
            return res.status(403).json({
              success: false,
              message: `Ces transactions ont été créées par un administrateur (${adminName ?? 'Admin'}). Veuillez contacter un administrateur.`,
              code: 'CREATED_BY_ADMIN'
            });
          }
        }

        const oldValue = matchingTransactions.reduce((sum, tx) => sum + Number(tx.montant), 0) / 100;

        if (matchingTransactions.length > 0) {
          await Promise.all(matchingTransactions.map(tx =>
            prisma.transaction.update({
              where: { id: tx.id },
              data: {
                description: `[SUPPRIMÉ] ${tx.description || ''}`,
                archived: true,
                archivedAt: new Date(),
                metadata: JSON.stringify({ deleted: true, resetBy: userId, resetAt: new Date().toISOString() })
              }
            })
          ));
        }

        await prisma.transaction.create({
          data: {
            montant: BigInt(Math.round(oldValue * 100)),
            type: 'AUDIT_MODIFICATION',
            description: `Reset partenaire ${partnerName} (${lineType}) - ${oldValue} F → 0 F`,
            envoyeurId: userId,
            destinataireId: supervisorId,
            metadata: JSON.stringify({ action: 'RESET_PARTNER_LINE', lineType, accountKey, partnerName, oldValue, newValue: 0, resetBy: userId, resetAt: new Date().toISOString() })
          }
        });

        await NotificationService.createNotification({
          userId: supervisorId,
          title: 'Partenaire réinitialisé',
          message: `Partenaire ${partnerName} (${lineType}) réinitialisé : ${oldValue} F → 0 F`,
          type: 'AUDIT_MODIFICATION'
        });

        return res.json({
          success: true,
          message: `Partenaire ${partnerName} (${lineType}) réinitialisé`,
          data: { accountKey, lineType, oldValue, newValue: 0, resetAt: new Date(), supervisor: supervisor.nomComplet }
        });
      }

      // ── Compte fixe
      const account = await prisma.account.upsert({
        where: { userId_type: { userId: supervisorId, type: accountKey } },
        update: {},
        create: { type: accountKey, userId: supervisorId, balance: 0n, initialBalance: 0n, previousInitialBalance: 0n }
      });

      const oldValue = lineType === 'debut'
        ? Number(account.initialBalance) / 100
        : Number(account.balance) / 100;
      const oldValueF2 = normalizedLineType === 'sortie' ? Number(account.finSecondaire) / 100 : null;
      const newValueF2Centimes = Math.round(newValueF2 * 100);

      const updateData = lineType === 'debut'
        ? { initialBalance: BigInt(newValueCentimes) }
        : { balance: BigInt(newValueCentimes), finSecondaire: BigInt(newValueF2Centimes) }; // ← F2 réinitialisé avec F

      await prisma.account.update({
        where: { id: account.id },
        data: updateData
      });

      await prisma.transaction.create({
        data: {
          montant: BigInt(Math.abs(newValueCentimes)),
          type: 'AUDIT_MODIFICATION',
          description: normalizedLineType === 'sortie'
            ? `Reset ${accountKey} (${lineType}) - ${oldValue} F → ${newValue} F | F2 : ${oldValueF2} F → ${newValueF2} F`
            : `Reset ${accountKey} (${lineType}) - ${oldValue} F → ${newValue} F`,
          envoyeurId: userId,
          destinataireId: supervisorId,
          compteDestinationId: account.id,
          metadata: JSON.stringify({
            action: 'RESET_ACCOUNT_LINE', lineType, accountKey, oldValue, newValue,
            ...(normalizedLineType === 'sortie' && { oldValueF2, newValueF2 }),
            resetBy: userId, resetByRole: req.user.role, resetAt: new Date().toISOString()
          })
        }
      });

      await NotificationService.createNotification({
        userId: supervisorId,
        title: 'Compte réinitialisé',
        message: normalizedLineType === 'sortie'
          ? `${accountKey} (sortie) réinitialisé : ${oldValue} F → ${newValue} F | F2 : ${oldValueF2} F → ${newValueF2} F`
          : `${accountKey} (début) réinitialisé : ${oldValue} F → ${newValue} F`,
        type: 'AUDIT_MODIFICATION'
      });

      res.json({
        success: true,
        message: `Compte ${accountKey} (${lineType}) réinitialisé`,
        data: {
          accountKey, lineType, oldValue, newValue,
          ...(normalizedLineType === 'sortie' && { oldValueF2, newValueF2 }),
          resetAt: new Date(), supervisor: supervisor.nomComplet
        }
      });

    } catch (error) {
      return handleControllerError(res, error, 'resetAccountLine');
    }
  }

  checkResetPermissions = async (user, supervisorId) => {
    if (user.role === 'ADMIN') return { allowed: true };
    if (user.role !== 'SUPERVISEUR') return { allowed: false, reason: 'Permissions insuffisantes' };
    if (user.id !== supervisorId) return { allowed: false, reason: 'Vous ne pouvez réinitialiser que vos propres comptes' };
    return { allowed: true };
  }

  // =====================================
  // HISTORIQUE
  // =====================================

  getAccountDeletionHistory = async (req, res) => {
    try {
      if (req.user.role !== 'ADMIN')
        return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });

      const { page = 1, limit = 20, supervisorId } = req.query;
      const whereClause = { type: { in: ['AUDIT_SUPPRESSION', 'AUDIT_MODIFICATION'] } };
      if (supervisorId) whereClause.destinataireId = supervisorId;

      const [auditRecords, totalCount] = await Promise.all([
        prisma.transaction.findMany({
          where: whereClause,
          include: {
            envoyeur:     { select: { nomComplet: true } },
            destinataire: { select: { nomComplet: true } },
            partenaire:   { select: { nomComplet: true } }
          },
          orderBy: { createdAt: 'desc' },
          skip: (parseInt(page) - 1) * parseInt(limit),
          take: parseInt(limit)
        }),
        prisma.transaction.count({ where: whereClause })
      ]);

      const formattedHistory = auditRecords.map(record => ({
        id: record.id, type: record.type, description: record.description,
        createdAt: record.createdAt,
        executedBy:   record.envoyeur?.nomComplet   || 'Inconnu',
        superviseur:  record.destinataire?.nomComplet || 'Inconnu',
        partenaire:   record.partenaire?.nomComplet  || null,
        montant: Number(record.montant) / 100,
        metadata: record.metadata ? JSON.parse(record.metadata) : null
      }));

      res.json({
        success: true,
        message: `${auditRecords.length} enregistrement(s) trouvé(s)`,
        data: {
          history: formattedHistory,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / parseInt(limit)),
            totalCount, limit: parseInt(limit)
          }
        }
      });

    } catch (error) {
      return handleControllerError(res, error, 'getAccountDeletionHistory');
    }
  }
}

const controller = new AccountLineController();

// Bind explicite de toutes les méthodes pour garantir le bon 'this' dans Express
export const deleteAccountLine     = controller.deleteAccountLine.bind(controller);
export const updateAccountLine     = controller.updateAccountLine.bind(controller);
export const resetAccountLine      = controller.resetAccountLine.bind(controller);
export const getAccountDeletionHistory = controller.getAccountDeletionHistory.bind(controller);

export default controller;