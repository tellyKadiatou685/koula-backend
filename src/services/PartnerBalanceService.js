// src/services/PartnerBalanceService.js — VERSION ENRICHIE
// ✅ Suppression logique avec impact card superviseur conditionnel
// ✅ Modification de montant avec recompute snapshot
// ✅ Filtrage historique par type et plage de dates
// ✅ Commentaire optionnel dans l'historique partenaire

import prisma from '../config/database.js';

class PartnerBalanceService {

  convertFromInt(value) {
    return Number(value) / 100;
  }

  convertToInt(value) {
    return Math.round(parseFloat(value) * 100);
  }

  // ─────────────────────────────────────────────────────────────────
  // FILTRE DE BASE : exclut les supprimées
  // ─────────────────────────────────────────────────────────────────
  getActiveTransactionFilter(partenaireId) {
    return {
      partenaireId,
      type: { in: ['DEPOT', 'RETRAIT'] },
      NOT: { description: { startsWith: '[SUPPRIMÉ]' } }
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // SUPPRESSION LOGIQUE D'UNE TRANSACTION
  //
  // Scénario 1 — Transaction via superviseur (destinataireId présent) :
  //   → Marquée [SUPPRIMÉ] + snapshot recomputed → card superviseur mise à jour
  //
  // Scénario 2 — Transaction admin directe (pas de destinataireId) :
  //   → Marquée [SUPPRIMÉ] dans l'historique partenaire uniquement
  //   → Aucun impact sur aucune card superviseur
  // ─────────────────────────────────────────────────────────────────
  async deleteTransaction(transactionId, requesterId) {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      select: {
        id:            true,
        type:          true,
        montant:       true,
        description:   true,
        destinataireId: true,
        envoyeurId:    true,
        partenaireId:  true,
        partenaireNom: true,
        archived:      true,
        archivedAt:    true,
        createdAt:     true,
      }
    });

    if (!transaction) throw new Error('Transaction introuvable');

    if (transaction.description?.startsWith('[SUPPRIMÉ]')) {
      throw new Error('Cette transaction est déjà supprimée');
    }

    // Vérification des droits
    const requester = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { id: true, role: true, nomComplet: true }
    });
    if (!requester) throw new Error('Utilisateur introuvable');

    const isAdmin      = requester.role === 'ADMIN';
    const isSupervisor = requester.role === 'SUPERVISEUR';

    if (isSupervisor && transaction.destinataireId !== requesterId) {
      throw new Error('Vous ne pouvez supprimer que vos propres transactions');
    }
    if (!isAdmin && !isSupervisor) {
      throw new Error('Permission refusée');
    }

    // Suppression logique — on préserve archived/archivedAt pour les snapshots
    const originalDescription = transaction.description ?? '';
    const newDescription =
      `[SUPPRIMÉ] ${originalDescription} — supprimé par ${requester.nomComplet}`.trim();

    await prisma.transaction.update({
      where: { id: transactionId },
      data: {
        description: newDescription,
        archived:    transaction.archived   ?? false,
        archivedAt:  transaction.archivedAt ?? null,
      }
    });

    // Impact card superviseur ?
    // Seulement si un superviseur est lié ET que c'est une tx partenaire
    const affectsCard = !!transaction.destinataireId &&
                        ['DEPOT', 'RETRAIT'].includes(transaction.type);

    if (affectsCard) {
      const dateStr = new Date(transaction.createdAt).toISOString().split('T')[0];
      setImmediate(async () => {
        try {
          const { default: TransactionService } = await import('./TransactionService.js');
          await TransactionService.recomputeAndSaveSnapshot(
            transaction.destinataireId,
            dateStr
          );
          console.log(`✅ [DELETE TX] Snapshot recomputed pour ${dateStr}`);
        } catch (e) {
          console.error('⚠️ [DELETE TX] Erreur recompute snapshot (non bloquant):', e);
        }
      });
    }

    return {
      success: true,
      transactionId,
      affectsCard,
      superviseurId: transaction.destinataireId ?? null,
      message: affectsCard
        ? 'Transaction supprimée — la card superviseur est mise à jour automatiquement'
        : 'Transaction supprimée — aucun impact sur les cards superviseurs (transaction directe admin)',
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // MODIFICATION DU MONTANT D'UNE TRANSACTION
  //
  // - Recalcule le solde partenaire
  // - Si superviseur impliqué → recompute snapshot → card mise à jour
  // - Si admin direct → impact historique partenaire uniquement
  // ─────────────────────────────────────────────────────────────────
  async updateTransactionMontant(transactionId, newMontant, requesterId) {
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      select: {
        id:             true,
        type:           true,
        montant:        true,
        description:    true,
        destinataireId: true,
        partenaireId:   true,
        partenaireNom:  true,
        archived:       true,
        archivedAt:     true,
        createdAt:      true,
      }
    });

    if (!transaction) throw new Error('Transaction introuvable');
    if (transaction.description?.startsWith('[SUPPRIMÉ]')) {
      throw new Error('Impossible de modifier une transaction supprimée');
    }
    if (!['DEPOT', 'RETRAIT'].includes(transaction.type)) {
      throw new Error('Seules les transactions dépôt/retrait sont modifiables');
    }

    const requester = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { id: true, role: true, nomComplet: true }
    });
    if (!requester) throw new Error('Utilisateur introuvable');

    const isAdmin      = requester.role === 'ADMIN';
    const isSupervisor = requester.role === 'SUPERVISEUR';

    if (isSupervisor && transaction.destinataireId !== requesterId) {
      throw new Error('Vous ne pouvez modifier que vos propres transactions');
    }
    if (!isAdmin && !isSupervisor) {
      throw new Error('Permission refusée');
    }

    const newMontantFloat = parseFloat(newMontant);
    if (isNaN(newMontantFloat) || newMontantFloat <= 0) {
      throw new Error('Montant invalide — doit être un nombre positif');
    }

    const newMontantInt = this.convertToInt(newMontantFloat);
    const oldMontantInt = Number(transaction.montant);

    if (newMontantInt === oldMontantInt) {
      throw new Error('Le nouveau montant est identique à l\'ancien');
    }

    // Mise à jour + trace d'audit dans une transaction atomique
    await prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id: transactionId },
        data: {
          montant:    newMontantInt,
          archived:   transaction.archived   ?? false,
          archivedAt: transaction.archivedAt ?? null,
        }
      });

      // Trace d'audit
      await tx.transaction.create({
        data: {
          montant:        newMontantInt,
          type:           'AUDIT_MODIFICATION',
          description:    `Modification montant tx ${transactionId} — ` +
                          `Ancien: ${this.convertFromInt(oldMontantInt)} F, ` +
                          `Nouveau: ${newMontantFloat} F — par ${requester.nomComplet}`,
          envoyeurId:     requesterId,
          destinataireId: transaction.destinataireId ?? undefined,
        }
      });
    });

    // Recompute snapshot si superviseur impliqué
    const affectsCard = !!transaction.destinataireId &&
                        ['DEPOT', 'RETRAIT'].includes(transaction.type);

    if (affectsCard) {
      const dateStr = new Date(transaction.createdAt).toISOString().split('T')[0];
      setImmediate(async () => {
        try {
          const { default: TransactionService } = await import('./TransactionService.js');
          await TransactionService.recomputeAndSaveSnapshot(
            transaction.destinataireId,
            dateStr
          );
          console.log(`✅ [UPDATE TX] Snapshot recomputed pour ${dateStr}`);
        } catch (e) {
          console.error('⚠️ [UPDATE TX] Erreur recompute snapshot (non bloquant):', e);
        }
      });
    }

    return {
      success: true,
      transactionId,
      ancienMontant: this.convertFromInt(oldMontantInt),
      nouveauMontant: newMontantFloat,
      affectsCard,
      message: affectsCard
        ? 'Montant modifié — la card superviseur est mise à jour automatiquement'
        : 'Montant modifié — aucun impact sur les cards superviseurs (transaction directe admin)',
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // TRANSACTION DIRECTE ADMIN → PARTENAIRE
  // + commentaire optionnel visible dans l'historique partenaire
  // ─────────────────────────────────────────────────────────────────
  async createAdminDirectTransaction(adminId, partenaireId, type, montant, commentaire = null) {
    const partner = await prisma.user.findUnique({
      where: { id: partenaireId, role: 'PARTENAIRE' },
      select: { id: true, nomComplet: true, status: true }
    });
    if (!partner) throw new Error('Partenaire introuvable');
    if (partner.status !== 'ACTIVE') throw new Error('Partenaire suspendu');

    const admin = await prisma.user.findUnique({
      where: { id: adminId, role: 'ADMIN' },
      select: { id: true, nomComplet: true }
    });
    if (!admin) throw new Error('Admin introuvable');

    const montantFloat = parseFloat(montant);
    if (isNaN(montantFloat) || montantFloat <= 0) throw new Error('Montant invalide');

    const montantInt = this.convertToInt(montantFloat);
    const typeUpper  = type === 'depot' ? 'DEPOT' : 'RETRAIT';

    // Description de base
    let description = typeUpper === 'DEPOT'
      ? `Dépôt direct admin — ${admin.nomComplet}`
      : `Retrait direct admin — ${admin.nomComplet}`;

    // Commentaire optionnel — stocké dans la description avec séparateur clair
    const commentaireTrimmed = commentaire?.trim() ?? null;
    if (commentaireTrimmed && commentaireTrimmed.length > 0) {
      description += ` | ${commentaireTrimmed}`;
    }

    const transaction = await prisma.transaction.create({
      data: {
        montant:     montantInt,
        type:        typeUpper,
        description,
        envoyeurId:  adminId,
        partenaireId,
        // PAS de destinataireId → invisible pour tous les superviseurs
      },
      select: {
        id: true, type: true, montant: true,
        description: true, createdAt: true
      }
    });

    return {
      id:          transaction.id,
      type:        transaction.type,
      montant:     this.convertFromInt(transaction.montant),
      description: transaction.description,
      commentaire: commentaireTrimmed,
      createdAt:   transaction.createdAt,
      partenaire:  partner.nomComplet,
      admin:       admin.nomComplet,
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // HISTORIQUE ENRICHI AVEC FILTRES
  //
  // Filtres supportés :
  //   - type        : 'DEPOT' | 'RETRAIT' | null (les deux)
  //   - dateDebut   : ISO string — début de plage
  //   - dateFin     : ISO string — fin de plage (incluse, jusqu'à 23:59:59)
  // ─────────────────────────────────────────────────────────────────
  async getPartnerHistory(partenaireId, filters = {}) {
    try {
      const partner = await prisma.user.findUnique({
        where: { id: partenaireId, role: 'PARTENAIRE' },
        select: { id: true, nomComplet: true, telephone: true, status: true, createdAt: true }
      });
      if (!partner) throw new Error('Partenaire introuvable');

      // Construction du filtre de base
      const baseFilter = {
        partenaireId,
        type: { in: ['DEPOT', 'RETRAIT'] },
        NOT: { description: { startsWith: '[SUPPRIMÉ]' } }
      };

      // Filtre par type (dépôt/retrait)
      if (filters.type && ['DEPOT', 'RETRAIT'].includes(filters.type.toUpperCase())) {
        baseFilter.type = filters.type.toUpperCase();
      }

      // Filtre par plage de dates
      if (filters.dateDebut || filters.dateFin) {
        baseFilter.createdAt = {};

        if (filters.dateDebut) {
          const debut = new Date(filters.dateDebut);
          if (!isNaN(debut.getTime())) {
            debut.setHours(0, 0, 0, 0);
            baseFilter.createdAt.gte = debut;
          }
        }

        if (filters.dateFin) {
          const fin = new Date(filters.dateFin);
          if (!isNaN(fin.getTime())) {
            fin.setHours(23, 59, 59, 999);
            baseFilter.createdAt.lte = fin;
          }
        }
      }

      const transactions = await prisma.transaction.findMany({
        where: baseFilter,
        select: {
          id:          true,
          type:        true,
          montant:     true,
          createdAt:   true,
          archived:    true,
          description: true,
          envoyeur: {
            select: {
              id:         true,
              nomComplet: true,
              role:       true,
              status:     true,
            }
          },
        },
        orderBy: { createdAt: 'desc' }
      });

      // Statistiques sur les transactions filtrées
      let totalDepots = 0, totalRetraits = 0;
      let plusGrosDepot = 0, plusGrosRetrait = 0;
      const montants = [];

      transactions.forEach(tx => {
        const m = this.convertFromInt(tx.montant);
        montants.push(m);
        if (tx.type === 'DEPOT') {
          totalDepots += m;
          if (m > plusGrosDepot) plusGrosDepot = m;
        } else {
          totalRetraits += m;
          if (m > plusGrosRetrait) plusGrosRetrait = m;
        }
      });

      const solde   = totalDepots - totalRetraits;
      const etat    = solde > 0 ? 'BOUTIQUE_DOIT' : solde < 0 ? 'PARTENAIRE_DOIT' : 'SOLDE';
      const moyenne = montants.length > 0
        ? montants.reduce((a, b) => a + b, 0) / montants.length
        : 0;

      const sorted   = [...transactions].sort((a, b) =>
        new Date(a.createdAt) - new Date(b.createdAt));
      const derniere = transactions[0]?.createdAt ?? null;
      const premiere = sorted[0]?.createdAt      ?? null;

      const txFormatted = transactions.map(tx => {
        const m   = this.convertFromInt(tx.montant);
        const emp = tx.envoyeur ?? null;

        let employeStatus = 'ACTIVE';
        if (!emp)                            employeStatus = 'DELETED';
        else if (emp.status === 'SUSPENDED') employeStatus = 'SUSPENDED';

        // Extraire le commentaire de la description
        // Format : "Label de base | Commentaire utilisateur"
        const rawDescription = tx.description ?? '';
        const isAdminDirect  = emp?.role === 'ADMIN';
        let commentaire = null;
        if (isAdminDirect && rawDescription.includes(' | ')) {
          commentaire = rawDescription.split(' | ').slice(1).join(' | ') || null;
        }

        return {
          id:            tx.id,
          type:          tx.type,
          montant:       m,
          createdAt:     tx.createdAt,
          archived:      tx.archived ?? false,
          description:   rawDescription,
          commentaire,                        // ← commentaire optionnel extrait
          isAdminDirect,
          superviseur: emp ? {
            id:         emp.id,
            nomComplet: emp.nomComplet,
            role:       emp.role,
            status:     employeStatus,
          } : null,
        };
      });

      return {
        partenaire: {
          id:         partner.id,
          nomComplet: partner.nomComplet,
          telephone:  partner.telephone,
          status:     partner.status,
          createdAt:  partner.createdAt,
        },
        solde: {
          montant:       solde,
          montantAbsolu: Math.abs(solde),
          etat,
          label: etat === 'BOUTIQUE_DOIT'
            ? `Boutique doit ${Math.abs(solde).toLocaleString('fr-FR')} F`
            : etat === 'PARTENAIRE_DOIT'
              ? `Partenaire doit ${Math.abs(solde).toLocaleString('fr-FR')} F`
              : 'Soldé ✅'
        },
        statistiques: {
          totalDepots,
          totalRetraits,
          nombreTransactions:  transactions.length,
          derniereTransaction: derniere,
          premiereTransaction: premiere,
          moyenneTransaction:  Math.round(moyenne),
          plusGrosDepot,
          plusGrosRetrait,
        },
        // Filtres appliqués — utile pour le frontend
        filtresAppliques: {
          type:      filters.type     ?? null,
          dateDebut: filters.dateDebut ?? null,
          dateFin:   filters.dateFin  ?? null,
        },
        transactions: txFormatted,
      };

    } catch (error) {
      console.error('❌ [PARTNER HISTORY] getPartnerHistory:', error.message);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // SOLDE SIMPLE
  // ─────────────────────────────────────────────────────────────────
  async getPartnerBalance(partenaireId) {
    const partner = await prisma.user.findUnique({
      where: { id: partenaireId, role: 'PARTENAIRE' },
      select: { id: true, nomComplet: true, telephone: true, status: true, createdAt: true }
    });
    if (!partner) throw new Error('Partenaire introuvable');

    const transactions = await prisma.transaction.findMany({
      where: this.getActiveTransactionFilter(partenaireId),
      select: {
        id: true, type: true, montant: true, createdAt: true, archived: true,
        description: true,
        destinataire: { select: { id: true, nomComplet: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    let totalDepots = 0, totalRetraits = 0;
    transactions.forEach(tx => {
      const m = this.convertFromInt(tx.montant);
      if (tx.type === 'DEPOT')   totalDepots   += m;
      if (tx.type === 'RETRAIT') totalRetraits += m;
    });

    const solde = totalDepots - totalRetraits;
    const etat  = solde > 0 ? 'BOUTIQUE_DOIT' : solde < 0 ? 'PARTENAIRE_DOIT' : 'SOLDE';

    return {
      partenaire: {
        id: partner.id, nomComplet: partner.nomComplet,
        telephone: partner.telephone, status: partner.status
      },
      solde: {
        montant: solde, montantAbsolu: Math.abs(solde), etat,
        label: etat === 'BOUTIQUE_DOIT'
          ? `Boutique doit ${Math.abs(solde).toLocaleString('fr-FR')} F`
          : etat === 'PARTENAIRE_DOIT'
            ? `Partenaire doit ${Math.abs(solde).toLocaleString('fr-FR')} F`
            : 'Soldé ✅'
      },
      statistiques: {
        totalDepots, totalRetraits,
        nombreTransactions: transactions.length,
        derniereTransaction: transactions[0]?.createdAt ?? null
      },
      transactions: transactions.map(tx => ({
        id:          tx.id,
        type:        tx.type,
        montant:     this.convertFromInt(tx.montant),
        createdAt:   tx.createdAt,
        archived:    tx.archived ?? false,
        description: tx.description ?? null,
        superviseur: tx.destinataire?.nomComplet ?? null
      }))
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // SOLDES DE TOUS LES PARTENAIRES
  // ─────────────────────────────────────────────────────────────────
  async getAllPartnersBalances() {
    try {
      const partners = await prisma.user.findMany({
        where: { role: 'PARTENAIRE' },
        select: { id: true, nomComplet: true, telephone: true, status: true },
        orderBy: { nomComplet: 'asc' }
      });

      const allTransactions = await prisma.transaction.findMany({
        where: {
          partenaireId: { in: partners.map(p => p.id) },
          type: { in: ['DEPOT', 'RETRAIT'] },
          NOT: { description: { startsWith: '[SUPPRIMÉ]' } }
        },
        select: { partenaireId: true, type: true, montant: true, createdAt: true }
      });

      const txByPartner = {};
      allTransactions.forEach(tx => {
        if (!txByPartner[tx.partenaireId])
          txByPartner[tx.partenaireId] = { depots: 0, retraits: 0, count: 0, derniere: null };
        const m = this.convertFromInt(tx.montant);
        if (tx.type === 'DEPOT')   txByPartner[tx.partenaireId].depots   += m;
        if (tx.type === 'RETRAIT') txByPartner[tx.partenaireId].retraits += m;
        txByPartner[tx.partenaireId].count++;
        if (!txByPartner[tx.partenaireId].derniere || tx.createdAt > txByPartner[tx.partenaireId].derniere)
          txByPartner[tx.partenaireId].derniere = tx.createdAt;
      });

      return partners.map(partner => {
        const data  = txByPartner[partner.id] ?? { depots: 0, retraits: 0, count: 0, derniere: null };
        const solde = data.depots - data.retraits;
        const etat  = solde > 0 ? 'BOUTIQUE_DOIT' : solde < 0 ? 'PARTENAIRE_DOIT' : 'SOLDE';
        return {
          id: partner.id, nomComplet: partner.nomComplet,
          telephone: partner.telephone, status: partner.status,
          solde: {
            montant: solde, montantAbsolu: Math.abs(solde), etat,
            label: etat === 'BOUTIQUE_DOIT'
              ? `Boutique doit ${Math.abs(solde).toLocaleString('fr-FR')} F`
              : etat === 'PARTENAIRE_DOIT'
                ? `Partenaire doit ${Math.abs(solde).toLocaleString('fr-FR')} F`
                : 'Soldé ✅'
          },
          statistiques: {
            totalDepots: data.depots, totalRetraits: data.retraits,
            nombreTransactions: data.count, derniereTransaction: data.derniere
          }
        };
      });
    } catch (error) {
      console.error('❌ [PARTNER BALANCE] getAllPartnersBalances:', error.message);
      throw error;
    }
  }
}

export default new PartnerBalanceService();