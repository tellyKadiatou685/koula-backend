// src/services/RecentTransactionService.js
import prisma from '../config/database.js';

class RecentTransactionService {

  async getRecentTransactionsWithFilters(filters = {}, pagination = {}) {
    try {
      const {
        search, supervisorId, partnerId, operatorId,
        transactionType, period = 'today', accountType,
        supervisorName, partnerName, operatorName, userName
      } = filters;

      const { page = 1, limit = 5, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;

      const dateFilter = this.getDateFilter(period);
      const whereConditions = { AND: [] };

      if (Object.keys(dateFilter).length > 0) {
        whereConditions.AND.push({ createdAt: dateFilter });
      }

      if (supervisorId) {
        whereConditions.AND.push({
          OR: [
            { destinataireId: supervisorId },
            { AND: [{ envoyeurId: supervisorId }, { destinataireId: null }] }
          ]
        });
      }

      if (partnerId) whereConditions.AND.push({ partenaireId: partnerId });

      if (operatorId) {
        whereConditions.AND.push({
          OR: [{ envoyeurId: operatorId }, { destinataireId: operatorId }]
        });
      }

      if (supervisorName && typeof supervisorName === 'string' && supervisorName.trim()) {
        whereConditions.AND.push({
          OR: [
            { envoyeur:     { nomComplet: { contains: supervisorName.trim() } } },
            { destinataire: { nomComplet: { contains: supervisorName.trim() } } }
          ]
        });
      }

      if (partnerName && typeof partnerName === 'string' && partnerName.trim()) {
        whereConditions.AND.push({
          partenaire: { nomComplet: { contains: partnerName.trim() } }
        });
      }

      if (operatorName && typeof operatorName === 'string' && operatorName.trim()) {
        whereConditions.AND.push({
          OR: [
            { envoyeur:     { nomComplet: { contains: operatorName.trim() } } },
            { destinataire: { nomComplet: { contains: operatorName.trim() } } }
          ]
        });
      }

      if (userName && typeof userName === 'string' && userName.trim()) {
        whereConditions.AND.push({
          OR: [
            { envoyeur:     { nomComplet: { contains: userName.trim() } } },
            { destinataire: { nomComplet: { contains: userName.trim() } } },
            { partenaire:   { nomComplet: { contains: userName.trim() } } }
          ]
        });
      }

      if (search && typeof search === 'string' && search.trim()) {
        whereConditions.AND.push({
          OR: [
            { description:  { contains: search.trim() } },
            { envoyeur:     { nomComplet: { contains: search.trim() } } },
            { destinataire: { nomComplet: { contains: search.trim() } } },
            { partenaire:   { nomComplet: { contains: search.trim() } } }
          ]
        });
      }

      if (transactionType && transactionType.toLowerCase() !== 'all' && transactionType.trim() !== '') {
        let typeFilter;
        switch (transactionType.toLowerCase()) {
          case 'depot':
          case 'depots':
            typeFilter = { type: { in: ['DEPOT', 'DEBUT_JOURNEE'] } };
            break;
          case 'retrait':
          case 'retraits':
            typeFilter = { type: { in: ['RETRAIT', 'FIN_JOURNEE'] } };
            break;
          case 'transfert':
          case 'transferts':
            typeFilter = { type: { in: ['TRANSFERT_ENVOYE', 'TRANSFERT_RECU'] } };
            break;
          case 'allocation':
          case 'allocations':
            typeFilter = { type: 'ALLOCATION_UV_MASTER' };
            break;
          default:
            const validTypes = ['DEPOT','RETRAIT','TRANSFERT_ENVOYE','TRANSFERT_RECU','ALLOCATION_UV_MASTER','DEBUT_JOURNEE','FIN_JOURNEE'];
            if (validTypes.includes(transactionType.toUpperCase())) {
              typeFilter = { type: transactionType.toUpperCase() };
            }
        }
        if (typeFilter) whereConditions.AND.push(typeFilter);
      }

      if (accountType && accountType.toLowerCase() !== 'all' && accountType.trim() !== '') {
        const validAccountTypes = ['LIQUIDE', 'ORANGE_MONEY', 'WAVE', 'UV_MASTER'];
        if (validAccountTypes.includes(accountType.toUpperCase())) {
          whereConditions.AND.push({
            compteDestination: { type: accountType.toUpperCase() }
          });
        }
      }

      const where = whereConditions.AND.length > 0 ? whereConditions : {};
      const skip  = (page - 1) * limit;

      const [transactions, totalCount] = await Promise.all([
        prisma.transaction.findMany({
          where,
          include: {
            envoyeur:          { select: { id: true, nomComplet: true, role: true, telephone: true } },
            destinataire:      { select: { id: true, nomComplet: true, role: true, telephone: true } },
            partenaire:        { select: { id: true, nomComplet: true, telephone: true } },
            compteDestination: { select: { type: true } }
          },
          orderBy: { [sortBy]: sortOrder },
          skip,
          take: limit
        }),
        prisma.transaction.count({ where })
      ]);

      const totalPages = Math.ceil(totalCount / limit);

      return {
        transactions: transactions.map(tx => this.formatTransaction(tx)),
        pagination: {
          currentPage:     page,
          totalPages,
          totalCount,
          hasNextPage:     page < totalPages,
          hasPreviousPage: page > 1,
          limit
        },
        stats:   this.calculateEnhancedStats(transactions),
        filters: { applied: filters, summary: `${totalCount} transaction(s) trouvee(s)` }
      };

    } catch (error) {
      console.error('Erreur getRecentTransactionsWithFilters:', error);
      throw new Error('Erreur lors de la recuperation des transactions');
    }
  }

  // ============================================================
  // FORMATAGE — LOGIQUE CORRIGEE
  // ------------------------------------------------------------
  // Admin fait FIN_JOURNEE pour Kadiatou :
  //   tx.envoyeur.role = 'ADMIN'        → intervenant = ADMIN
  //   tx.destinataire  = Kadiatou (SUP) → superviseur = Kadiatou
  //
  // Partenaire Mamadou chez Kadiatou :
  //   tx.partenaire    = Mamadou        → intervenant = PARTENAIRE
  //   tx.destinataire  = Kadiatou (SUP) → superviseur = Kadiatou
  //
  // Superviseur fait sa propre transaction :
  //   tx.envoyeur.role = 'SUPERVISEUR'  → intervenant = SUPERVISEUR
  // ============================================================
  formatTransaction(tx) {
    const montant  = Number(tx.montant) / 100;

    // Nom reel de l'admin (depuis envoyeur si role ADMIN)
    const adminNom = tx.envoyeur?.role === 'ADMIN'
      ? (tx.envoyeur.nomComplet || 'Administrateur')
      : 'Administrateur';

    let intervenant;

    if (tx.partenaire) {
      // CAS 1 — partenaire enregistre
      intervenant = {
        nom:       `part-${tx.partenaire.nomComplet}`,
        role:      'PARTENAIRE',
        id:        tx.partenaire.id,
        telephone: tx.partenaire.telephone || null
      };

    } else if (tx.partenaireNom) {
      // CAS 2 — partenaire libre (non enregistre)
      intervenant = {
        nom:       `part-${tx.partenaireNom}`,
        role:      'PARTENAIRE',
        id:        null,
        telephone: null
      };

    } else if (tx.envoyeur?.role === 'ADMIN') {
      // CAS 3 — ADMIN a saisi : afficher SON vrai nom, pas le destinataire
      intervenant = {
        nom:        `adm-${adminNom}`,
        role:       'ADMIN',
        id:         tx.envoyeur.id,
        nomComplet: adminNom
      };

    } else if (tx.envoyeur && tx.envoyeur.role !== 'ADMIN') {
      // CAS 4 — superviseur/autre qui envoie lui-meme
      intervenant = {
        nom:       `sup-${tx.envoyeur.nomComplet}`,
        role:      tx.envoyeur.role,
        id:        tx.envoyeur.id,
        telephone: tx.envoyeur.telephone || null
      };

    } else if (tx.destinataire && tx.destinataire.role !== 'ADMIN') {
      // CAS 5 — fallback destinataire non-admin
      intervenant = {
        nom:       `sup-${tx.destinataire.nomComplet}`,
        role:      tx.destinataire.role,
        id:        tx.destinataire.id,
        telephone: tx.destinataire.telephone || null
      };

    } else {
      // CAS 6 — fallback ultime
      intervenant = {
        nom:        `adm-${adminNom}`,
        role:       'ADMIN',
        id:         tx.envoyeur?.id || null,
        nomComplet: adminNom
      };
    }

    // Superviseur concerne = destinataire SUPERVISEUR ou envoyeur SUPERVISEUR
    let superviseur = { nom: 'N/A', id: null };
    if (tx.destinataire?.role === 'SUPERVISEUR') {
      superviseur = { nom: tx.destinataire.nomComplet, id: tx.destinataire.id };
    } else if (tx.envoyeur?.role === 'SUPERVISEUR') {
      superviseur = { nom: tx.envoyeur.nomComplet, id: tx.envoyeur.id };
    }

    return {
      id:        tx.id,
      dateHeure: tx.createdAt.toISOString(),
      intervenant,
      adminNom:  intervenant.role === 'ADMIN' ? adminNom : null,
      type: {
        code:     tx.type,
        label:    this.getTransactionTypeLabel(tx.type),
        category: this.getTransactionCategory(tx.type)
      },
      montant: {
        valeur:    montant,
        formatted: this.formatAmount(montant),
        signe:     ['DEPOT','DEBUT_JOURNEE','ALLOCATION_UV_MASTER','TRANSFERT_RECU'].includes(tx.type) ? '+' : '-'
      },
      compte:      tx.compteDestination?.type || 'N/A',
      superviseur,
      description: tx.description,
      statut:      'Valide',
      metadata: {
        hasPartner:    !!(tx.partenaire || tx.partenaireNom),
        hasSupervisor: superviseur.id !== null,
        isAdminAction: intervenant.role === 'ADMIN'
      }
    };
  }

  async getTransactionsPaginatedByFive(filters = {}, page = 1) {
    return await this.getRecentTransactionsWithFilters(filters, { page, limit: 5 });
  }

  async searchEntities(query, type = 'all', limit = 10) {
    try {
      const searchTerm = query.trim();
      const results = { superviseurs: [], partenaires: [], operateurs: [], total: 0 };

      if (type === 'all' || type === 'superviseur') {
        results.superviseurs = await prisma.user.findMany({
          where: { role: 'SUPERVISEUR', status: 'ACTIVE', nomComplet: { contains: searchTerm } },
          select: { id: true, nomComplet: true, telephone: true },
          take: limit
        });
      }
      if (type === 'all' || type === 'partenaire') {
        results.partenaires = await prisma.user.findMany({
          where: { role: 'PARTENAIRE', status: 'ACTIVE', nomComplet: { contains: searchTerm } },
          select: { id: true, nomComplet: true, telephone: true },
          take: limit
        });
      }
      if (type === 'all' || type === 'operateur') {
        results.operateurs = await prisma.user.findMany({
          where: { role: 'OPERATEUR', status: 'ACTIVE', nomComplet: { contains: searchTerm } },
          select: { id: true, nomComplet: true, telephone: true },
          take: limit
        });
      }

      results.total = results.superviseurs.length + results.partenaires.length + results.operateurs.length;
      return results;
    } catch (error) {
      console.error('Erreur searchEntities:', error);
      throw new Error("Erreur lors de la recherche d'entites");
    }
  }

  async checkAccountBalance(supervisorId, accountType, amount) {
    try {
      const account = await prisma.account.findFirst({
        where: { userId: supervisorId, type: accountType.toUpperCase() }
      });
      if (!account) {
        return { exists: false, sufficient: false, currentBalance: 0, requested: parseFloat(amount) || 0 };
      }
      const currentBalance  = Number(account.balance) / 100;
      const requestedAmount = parseFloat(amount) || 0;
      return {
        exists:        true,
        sufficient:    currentBalance >= requestedAmount,
        currentBalance,
        requested:     requestedAmount,
        difference:    currentBalance - requestedAmount
      };
    } catch (error) {
      console.error('Erreur checkAccountBalance:', error);
      throw new Error('Erreur lors de la verification du solde');
    }
  }

  async exportTransactionsToExcel(filters, userRole) {
    try {
      const result = await this.getRecentTransactionsWithFilters(filters, { limit: 5000 });
      const exportData = result.transactions.map(tx => ({
        'Date et Heure':    tx.dateHeure,
        'Intervenant':      tx.intervenant.role === 'ADMIN'
                              ? (tx.adminNom || 'Administrateur')
                              : tx.intervenant.nom.replace(/^(part-|sup-)/, ''),
        'Role':             tx.intervenant.role,
        'Type Transaction': tx.type.label,
        'Montant (F CFA)':  tx.montant.valeur,
        'Compte':           tx.compte,
        'Superviseur':      tx.superviseur.nom,
        'Description':      tx.description,
        'Statut':           'Valide'
      }));
      return {
        success:  true,
        data:     exportData,
        metadata: {
          nomFichier:         `transactions_${new Date().toISOString().split('T')[0]}_${userRole.toLowerCase()}.json`,
          dateExport:         new Date().toISOString(),
          nombreTransactions: exportData.length,
          filtresAppliques:   filters,
          exportePar:         userRole
        }
      };
    } catch (error) {
      console.error('Erreur exportTransactionsToExcel:', error);
      return { success: false, error: error.message };
    }
  }

  getTransactionCategory(type) {
    const c = {
      DEPOT: 'depot', DEBUT_JOURNEE: 'depot', TRANSFERT_RECU: 'depot',
      ALLOCATION_UV_MASTER: 'allocation',
      RETRAIT: 'retrait', FIN_JOURNEE: 'retrait',
      TRANSFERT_ENVOYE: 'transfert'
    };
    return c[type] || 'autre';
  }

  calculateEnhancedStats(transactions) {
    const stats = {
      total:      transactions.length,
      byType:     {},
      byRole:     {},
      byCategory: { depot: 0, retrait: 0, transfert: 0, allocation: 0 },
      amounts:    { total: 0, entrees: 0, sorties: 0 }
    };
    transactions.forEach(tx => {
      const montant = Number(tx.montant) / 100;
      stats.byType[tx.type] = (stats.byType[tx.type] || 0) + 1;
      const role = tx.partenaire ? 'PARTENAIRE' : tx.envoyeur?.role || tx.destinataire?.role || 'ADMIN';
      stats.byRole[role] = (stats.byRole[role] || 0) + 1;
      const cat = this.getTransactionCategory(tx.type);
      stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
      if (['DEPOT','DEBUT_JOURNEE','ALLOCATION_UV_MASTER','TRANSFERT_RECU'].includes(tx.type)) {
        stats.amounts.entrees += montant;
      } else {
        stats.amounts.sorties += montant;
      }
      stats.amounts.total += Math.abs(montant);
    });
    return stats;
  }

  getTransactionTypeLabel(type) {
    const l = {
      DEPOT: 'Depot', RETRAIT: 'Retrait',
      TRANSFERT_ENVOYE: 'Transfert envoye', TRANSFERT_RECU: 'Transfert recu',
      ALLOCATION_UV_MASTER: 'Allocation UV Master',
      DEBUT_JOURNEE: 'Debut journee', FIN_JOURNEE: 'Fin journee'
    };
    return l[type] || type;
  }

  getDateFilter(period) {
    const now = new Date();
    switch (period.toLowerCase()) {
      case 'today': {
        const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const e = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        return { gte: s, lte: e };
      }
      case 'yesterday': {
        const y = new Date(now);
        y.setDate(now.getDate() - 1);
        const s = new Date(y.getFullYear(), y.getMonth(), y.getDate());
        const e = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59);
        return { gte: s, lte: e };
      }
      case 'week': {
        const w = new Date(now);
        w.setDate(now.getDate() - 7);
        return { gte: w, lte: now };
      }
      case 'month':
        return { gte: new Date(now.getFullYear(), now.getMonth(), 1), lte: now };
      case 'year':
        return { gte: new Date(now.getFullYear(), 0, 1), lte: now };
      case 'all':
      default:
        return {};
    }
  }

  formatAmount(amount, withSign = false) {
    const abs  = Math.abs(amount);
    const sign = withSign && amount > 0 ? '+' : '';
    if (abs >= 1000000) return `${sign}${(amount / 1000000).toFixed(1)}M F`;
    if (abs >= 1000)    return `${sign}${Math.round(amount / 1000)}K F`;
    return `${sign}${amount.toLocaleString()} F`;
  }
}

export default new RecentTransactionService();