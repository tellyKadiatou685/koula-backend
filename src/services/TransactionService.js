// src/services/TransactionService.js - VERSION AVEC TYPES DE COMPTES DYNAMIQUES + ACCÈS SAISIE
import prisma from '../config/database.js';
import NotificationService from './NotificationService.js';
import AccountTypeService from './AccountTypeService.js';

class TransactionService {
  static RESET_CONFIG = {
    hour: 0,
    minute: 50,
    windowMinutes: 0
  };

  async needsDashboardRefresh(lastCheckTime) {
    try {
      const resetConfig = this.getResetConfig();
      const now = new Date();
      const todayResetTime = new Date(now);
      todayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);

      if (now > todayResetTime && lastCheckTime < todayResetTime) {
        return {
          needsRefresh: true,
          resetExecutedAt: todayResetTime.toISOString(),
          reason: 'reset_occurred_since_last_check',
          currentTime: now.toISOString()
        };
      }

      let nextResetTime = new Date(todayResetTime);
      if (now > todayResetTime) {
        nextResetTime.setDate(nextResetTime.getDate() + 1);
      }

      return {
        needsRefresh: false,
        nextResetAt: nextResetTime.toISOString(),
        currentTime: now.toISOString(),
        minutesUntilReset: Math.ceil((nextResetTime - now) / (1000 * 60))
      };

    } catch (error) {
      console.error('❌ [REFRESH CHECK] Erreur:', error);
      return { needsRefresh: false, error: error.message };
    }
  }

  async notifyDashboardRefresh(resetDetails = {}) {
    try {
      console.log('📢 [NOTIFICATIONS] Envoi notifications de reset...');

      const now = new Date();
      const { archivedCount = 0, cleanedCount = 0 } = resetDetails;

      const [activeSupervisors, adminUsers, activePartners] = await Promise.all([
        prisma.user.findMany({
          where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
          select: { id: true, nomComplet: true }
        }),
        prisma.user.findMany({
          where: { role: 'ADMIN' },
          select: { id: true, nomComplet: true }
        }),
        prisma.user.findMany({
          where: { role: 'PARTENAIRE', status: 'ACTIVE' },
          select: { id: true, nomComplet: true }
        })
      ]);

      const notifications = [];

      activeSupervisors.forEach(supervisor => {
        notifications.push({
          userId: supervisor.id,
          title: 'Dashboard Actualisé',
          message: `Reset quotidien effectué à ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}. Vos soldes ont été transférés et les données mises à jour.`,
          type: 'RESET_SUPERVISOR'
        });
      });

      adminUsers.forEach(admin => {
        notifications.push({
          userId: admin.id,
          title: 'Reset Quotidien Terminé',
          message: `Reset effectué avec succès : ${archivedCount} transactions archivées, ${cleanedCount} nettoyées. Tous les dashboards sont à jour.`,
          type: 'RESET_ADMIN'
        });
      });

      activePartners.forEach(partner => {
        notifications.push({
          userId: partner.id,
          title: 'Nouveau Jour Commencé',
          message: `Les compteurs ont été remis à zéro. Nouveau cycle de transactions disponible.`,
          type: 'RESET_PARTNER'
        });
      });

      const notificationPromises = notifications.map(notif =>
        NotificationService.createNotification(notif)
      );

      const results = await Promise.allSettled(notificationPromises);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      console.log(`✅ [NOTIFICATIONS] ${successful} notifications envoyées, ${failed} échecs`);

      return { totalNotifications: notifications.length, successful, failed, details: resetDetails };

    } catch (error) {
      console.error('❌ [NOTIFICATIONS] Erreur envoi notifications:', error);
      return { error: error.message, totalNotifications: 0, successful: 0, failed: 0 };
    }
  }

  getResetConfig() {
    return TransactionService.RESET_CONFIG;
  }

  setResetConfig(hour, minute, windowMinutes = 5) {
    TransactionService.RESET_CONFIG = { hour, minute, windowMinutes };
    console.log(`🔧 [CONFIG] Reset configuré pour ${hour}:${minute.toString().padStart(2, '0')} (fenêtre: ${windowMinutes}min)`);
  }

  isInResetWindow() {
    const now = new Date();
    const resetConfig = this.getResetConfig();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    let isInWindow;
    if (resetConfig.windowMinutes === 0) {
      isInWindow = currentHour === resetConfig.hour && currentMinute === resetConfig.minute;
    } else {
      const startMinute = resetConfig.minute;
      const endMinute = resetConfig.minute + resetConfig.windowMinutes;
      isInWindow = currentHour === resetConfig.hour &&
                   currentMinute >= startMinute &&
                   currentMinute <= endMinute;
    }

    return {
      isInWindow,
      currentTime: `${currentHour}:${currentMinute.toString().padStart(2, '0')}`,
      resetTime: `${resetConfig.hour}:${resetConfig.minute.toString().padStart(2, '0')}`,
      windowType: resetConfig.windowMinutes === 0 ? 'précis' : `fenêtre ${resetConfig.windowMinutes}min`
    };
  }

  getYesterdayRange() {
    const now = new Date();
    const resetConfig = this.getResetConfig();

    const yesterdayResetTime = new Date(now);
    yesterdayResetTime.setDate(now.getDate() - 1);
    yesterdayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);

    const todayResetTime = new Date(now);
    todayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);

    const startOfYesterday = yesterdayResetTime;
    const endOfYesterday = new Date(todayResetTime.getTime() - 1000);

    console.log(`📅 [YESTERDAY RANGE] ${yesterdayResetTime.toISOString()} -> ${endOfYesterday.toISOString()}`);

    return { startOfYesterday, endOfYesterday };
  }

  getCustomDateRange(targetDate) {
    const resetConfig = this.getResetConfig();
    const customDate = new Date(targetDate);

    const startOfCustom = new Date(customDate);
    startOfCustom.setHours(resetConfig.hour, resetConfig.minute, 0, 0);

    const nextDayReset = new Date(startOfCustom);
    nextDayReset.setDate(startOfCustom.getDate() + 1);
    const endOfCustom = new Date(nextDayReset.getTime() - 1000);

    return { startOfCustom, endOfCustom };
  }

  async shouldIncludeArchivedTransactions(period, customDate = null) {
    try {
      const lastResetDate = await this.getLastResetDate();
      const today = new Date().toDateString();

      const resetReallyExecutedToday = lastResetDate &&
                                       lastResetDate.includes(today) &&
                                       lastResetDate.includes('SUCCESS');

      console.log(`🔍 [RESET CHECK] Aujourd'hui: ${today}, Dernier reset: ${lastResetDate}, Reset exécuté: ${resetReallyExecutedToday}`);

      if (period === 'custom' && customDate) {
        const targetDate = new Date(customDate);
        const targetDateOnly = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
        const todayOnly = new Date();
        todayOnly.setHours(0, 0, 0, 0);

        if (targetDateOnly < todayOnly) return true;
        else return false;
      }

      if (period === 'yesterday') return true;

      return false;

    } catch (error) {
      console.error('❌ [SHOULD INCLUDE ARCHIVED] Erreur:', error);
      return false;
    }
  }

  // =====================================
  // SYSTÈME DE SNAPSHOTS QUOTIDIENS
  // =====================================
  async createDailySnapshot(userId, date = new Date()) {
    try {
      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);

      console.log(`📸 [SNAPSHOT] Création snapshot pour ${userId} le ${targetDate.toISOString().split('T')[0]}`);

      const accounts = await prisma.account.findMany({
        where: { userId },
        select: { type: true, balance: true, initialBalance: true }
      });

      const snapshotData = {
        date: targetDate,
        userId,
        liquideDebut:     BigInt(0),
        orangeMoneyDebut: BigInt(0),
        waveDebut:        BigInt(0),
        uvMasterDebut:    BigInt(0),
        autresDebut:      BigInt(0),
        liquideFin:       BigInt(0),
        orangeMoneyFin:   BigInt(0),
        waveFin:          BigInt(0),
        uvMasterFin:      BigInt(0),
        autresFin:        BigInt(0),
        debutTotal:       BigInt(0),
        sortieTotal:      BigInt(0),
        grTotal:          BigInt(0)
      };

      const typeToSnapshotField = {
        'LIQUIDE':       ['liquideDebut',      'liquideFin'],
        'ORANGE_MONEY':  ['orangeMoneyDebut',  'orangeMoneyFin'],
        'WAVE':          ['waveDebut',          'waveFin'],
        'UV_MASTER':     ['uvMasterDebut',      'uvMasterFin'],
        'AUTRES':        ['autresDebut',        'autresFin'],
        'FREE_MONEY':    ['autresDebut',        'autresFin'],
        'WESTERN_UNION': ['autresDebut',        'autresFin'],
        'RIA':           ['autresDebut',        'autresFin'],
        'MONEYGRAM':     ['autresDebut',        'autresFin'],
      };

      accounts.forEach(account => {
        const debut = account.initialBalance;
        const fin   = account.balance;

        const fields = typeToSnapshotField[account.type];
        if (fields) {
          const [debutField, finField] = fields;
          snapshotData[debutField] += debut;
          snapshotData[finField]   += fin;
        }

        snapshotData.debutTotal  += debut;
        snapshotData.sortieTotal += fin;
      });

      snapshotData.grTotal = snapshotData.sortieTotal - snapshotData.debutTotal;

      const snapshot = await prisma.dailySnapshot.upsert({
        where: { userId_date: { userId, date: targetDate } },
        update: snapshotData,
        create: snapshotData
      });

      console.log(`✅ [SNAPSHOT] Snapshot créé pour ${userId}`);
      return snapshot;

    } catch (error) {
      console.error('❌ [SNAPSHOT] Erreur création snapshot:', error);
      throw error;
    }
  }

  async recomputeAndSaveSnapshot(supervisorId, targetDateStr) {
    try {
      const date = new Date(targetDateStr);
      date.setHours(0, 0, 0, 0);

      console.log(`🔄 [SNAPSHOT RECOMPUTE] Supervisor: ${supervisorId}, Date: ${targetDateStr}`);

      const resetConfig = this.getResetConfig();

      const startOfDay = new Date(date);
      startOfDay.setHours(resetConfig.hour, resetConfig.minute, 0, 0);

      const nextDay = new Date(startOfDay);
      nextDay.setDate(nextDay.getDate() + 1);
      const endOfDay = new Date(nextDay.getTime() - 1000);

      const transactions = await prisma.transaction.findMany({
        where: {
          destinataireId: supervisorId,
          createdAt: { gte: startOfDay, lte: endOfDay },
          NOT: { description: { startsWith: '[SUPPRIMÉ]' } }
        },
        select: {
          type: true, montant: true,
          partenaireId: true, partenaireNom: true,
          partenaire: { select: { nomComplet: true } }
        }
      });

      const accounts = await prisma.account.findMany({
        where: { userId: supervisorId },
        select: { type: true, balance: true, initialBalance: true, previousInitialBalance: true }
      });

      const snapshotData = {
        date,
        userId: supervisorId,
        liquideDebut:     BigInt(0),
        orangeMoneyDebut: BigInt(0),
        waveDebut:        BigInt(0),
        uvMasterDebut:    BigInt(0),
        autresDebut:      BigInt(0),
        liquideFin:       BigInt(0),
        orangeMoneyFin:   BigInt(0),
        waveFin:          BigInt(0),
        uvMasterFin:      BigInt(0),
        autresFin:        BigInt(0),
        debutTotal:       BigInt(0),
        sortieTotal:      BigInt(0),
        grTotal:          BigInt(0)
      };

      const typeToSnapshotField = {
        'LIQUIDE':       ['liquideDebut',      'liquideFin'],
        'ORANGE_MONEY':  ['orangeMoneyDebut',  'orangeMoneyFin'],
        'WAVE':          ['waveDebut',          'waveFin'],
        'UV_MASTER':     ['uvMasterDebut',      'uvMasterFin'],
        'AUTRES':        ['autresDebut',        'autresFin'],
        'FREE_MONEY':    ['autresDebut',        'autresFin'],
        'WESTERN_UNION': ['autresDebut',        'autresFin'],
        'RIA':           ['autresDebut',        'autresFin'],
        'MONEYGRAM':     ['autresDebut',        'autresFin'],
      };

      accounts.forEach(account => {
        const debut = account.previousInitialBalance || BigInt(0);
        const fin   = account.initialBalance || BigInt(0);

        const fields = typeToSnapshotField[account.type];
        if (fields) {
          const [debutField, finField] = fields;
          snapshotData[debutField] += debut;
          snapshotData[finField]   += fin;
        }

        snapshotData.debutTotal  += debut;
        snapshotData.sortieTotal += fin;
      });

      let partnerDebutTotal = BigInt(0);
      let partnerSortieTotal = BigInt(0);

      transactions.forEach(tx => {
        if (tx.type === 'DEPOT' || tx.type === 'RETRAIT') {
          const montant = BigInt(tx.montant);
          if (tx.type === 'DEPOT')   partnerDebutTotal  += montant;
          if (tx.type === 'RETRAIT') partnerSortieTotal += montant;
        }
      });

      snapshotData.debutTotal  += partnerDebutTotal;
      snapshotData.sortieTotal += partnerSortieTotal;
      snapshotData.grTotal = snapshotData.sortieTotal - snapshotData.debutTotal;

      const snapshot = await prisma.dailySnapshot.upsert({
        where: { userId_date: { userId: supervisorId, date } },
        update: snapshotData,
        create: snapshotData
      });

      console.log(`✅ [SNAPSHOT RECOMPUTE] Snapshot mis à jour pour ${supervisorId} le ${targetDateStr}`);
      return snapshot;

    } catch (error) {
      console.error('❌ [SNAPSHOT RECOMPUTE] Erreur:', error);
      throw error;
    }
  }

  async createSnapshotsForAllSupervisors(date = new Date()) {
    try {
      console.log(`📸 [BATCH SNAPSHOT] Création snapshots pour tous les superviseurs...`);

      const supervisors = await prisma.user.findMany({
        where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
        select: { id: true, nomComplet: true }
      });

      const results = await Promise.allSettled(
        supervisors.map(sup => this.createDailySnapshot(sup.id, date))
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      console.log(`✅ [BATCH SNAPSHOT] ${successful} snapshots créés, ${failed} échecs`);

      return { successful, failed, total: supervisors.length };

    } catch (error) {
      console.error('❌ [BATCH SNAPSHOT] Erreur:', error);
      throw error;
    }
  }

  async getSnapshotForDate(userId, targetDate) {
    try {
      const date = new Date(targetDate);
      date.setHours(0, 0, 0, 0);

      const snapshot = await prisma.dailySnapshot.findUnique({
        where: { userId_date: { userId, date } }
      });

      if (!snapshot) {
        console.log(`⚠️ [SNAPSHOT] Aucun snapshot trouvé pour ${userId} le ${date.toISOString().split('T')[0]}`);
        return null;
      }

      return {
        date: snapshot.date,
        comptes: {
          debut: {
            LIQUIDE:       this.convertFromInt(snapshot.liquideDebut),
            ORANGE_MONEY:  this.convertFromInt(snapshot.orangeMoneyDebut),
            WAVE:          this.convertFromInt(snapshot.waveDebut),
            UV_MASTER:     this.convertFromInt(snapshot.uvMasterDebut),
            AUTRES:        this.convertFromInt(snapshot.autresDebut)
          },
          sortie: {
            LIQUIDE:       this.convertFromInt(snapshot.liquideFin),
            ORANGE_MONEY:  this.convertFromInt(snapshot.orangeMoneyFin),
            WAVE:          this.convertFromInt(snapshot.waveFin),
            UV_MASTER:     this.convertFromInt(snapshot.uvMasterFin),
            AUTRES:        this.convertFromInt(snapshot.autresFin)
          }
        },
        totaux: {
          debutTotal:  this.convertFromInt(snapshot.debutTotal),
          sortieTotal: this.convertFromInt(snapshot.sortieTotal),
          grTotal:     this.convertFromInt(snapshot.grTotal)
        }
      };

    } catch (error) {
      console.error('❌ [SNAPSHOT] Erreur récupération snapshot:', error);
      return null;
    }
  }

  async migrateHistoricalDataToSnapshots(daysBack = 7) {
    try {
      console.log(`🔄 [MIGRATION] Migration des ${daysBack} derniers jours vers snapshots...`);

      const supervisors = await prisma.user.findMany({
        where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
        select: { id: true, nomComplet: true }
      });

      const results = [];

      for (let i = 1; i <= daysBack; i++) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - i);
        targetDate.setHours(0, 0, 0, 0);

        for (const supervisor of supervisors) {
          try {
            const existing = await prisma.dailySnapshot.findUnique({
              where: { userId_date: { userId: supervisor.id, date: targetDate } }
            });

            if (existing) continue;

            await this.createDailySnapshot(supervisor.id, targetDate);
            results.push({ date: targetDate, userId: supervisor.id, success: true });

          } catch (error) {
            results.push({ date: targetDate, userId: supervisor.id, success: false, error: error.message });
          }
        }
      }

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return { successful, failed, total: results.length, details: results };

    } catch (error) {
      console.error('❌ [MIGRATION] Erreur migration:', error);
      throw error;
    }
  }

  generateReference(prefix = 'TXN') {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }

  formatAmount(amount, withSign = false) {
    const num = typeof amount === 'number' ? amount : parseFloat(amount);
    if (withSign) {
      if (num > 0) return `+${num.toLocaleString('fr-FR')} F`;
      else return `${num.toLocaleString('fr-FR')} F`;
    }
    return `${Math.abs(num).toLocaleString('fr-FR')} F`;
  }

  getDateFilter(period = 'today', customDate = null) {
    const now = new Date();
    const resetConfig = this.getResetConfig();

    console.log(`🔍 [DATE FILTER] Période: "${period}", Date custom: ${customDate}`);

    if (period === 'custom' && customDate) {
      const targetDate = new Date(customDate);
      if (isNaN(targetDate.getTime())) throw new Error('Date invalide');

      const startOfCustom = new Date(targetDate);
      startOfCustom.setHours(resetConfig.hour, resetConfig.minute, 0, 0);

      const nextDayReset = new Date(startOfCustom);
      nextDayReset.setDate(nextDayReset.getDate() + 1);
      const endOfCustom = new Date(nextDayReset.getTime() - 1000);

      return { gte: startOfCustom, lte: endOfCustom };
    }

    switch (period.toLowerCase()) {
      case 'today': {
        const todayResetTime = new Date(now);
        todayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        let startOfToday;
        if (now < todayResetTime) {
          const yesterdayReset = new Date(todayResetTime);
          yesterdayReset.setDate(yesterdayReset.getDate() - 1);
          startOfToday = yesterdayReset;
        } else {
          startOfToday = todayResetTime;
        }
        return { gte: startOfToday, lte: now };
      }

      case 'yesterday': {
        const yesterdayResetTime = new Date(now);
        yesterdayResetTime.setDate(now.getDate() - 1);
        yesterdayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        const todayResetTimeForYesterday = new Date(now);
        todayResetTimeForYesterday.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        return {
          gte: yesterdayResetTime,
          lte: new Date(todayResetTimeForYesterday.getTime() - 1000)
        };
      }

      case 'week': {
        const weekAgo = new Date(now);
        weekAgo.setDate(now.getDate() - 7);
        weekAgo.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        return { gte: weekAgo, lte: now };
      }

      case 'month': {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        startOfMonth.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        return { gte: startOfMonth, lte: now };
      }

      case 'year': {
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        startOfYear.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        return { gte: startOfYear, lte: now };
      }

      case 'all':
        return {};

      default: {
        const defaultStart = new Date(now);
        defaultStart.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        return { gte: defaultStart, lte: now };
      }
    }
  }

  validateCustomDateTime(dateTimeString) {
    if (!dateTimeString) return { valid: false, error: 'DateTime requise' };

    const dateTime = new Date(dateTimeString);
    if (isNaN(dateTime.getTime())) {
      return { valid: false, error: 'Format de datetime invalide. Utilisez: YYYY-MM-DD' };
    }

    const now = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(now.getFullYear() - 1);

    if (dateTime > now) return { valid: false, error: 'DateTime future non autorisée' };
    if (dateTime < oneYearAgo) return { valid: false, error: 'DateTime trop ancienne (limite: 1 an)' };

    return { valid: true, dateTime };
  }

  formatDateForDisplay(dateString) {
    const date = new Date(dateString);
    return {
      short: date.toLocaleDateString('fr-FR'),
      long: date.toLocaleDateString('fr-FR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      }),
      iso: date.toISOString().split('T')[0]
    };
  }

  extractAccountTypeFromDescription(description) {
    if (!description) return 'LIQUIDE';
    const desc = description.toUpperCase();
    if (desc.includes('LIQUIDE')) return 'LIQUIDE';
    if (desc.includes('ORANGE') || desc.includes('OM')) return 'ORANGE_MONEY';
    if (desc.includes('WAVE')) return 'WAVE';
    if (desc.includes('UV_MASTER') || desc.includes('UV MASTER')) return 'UV_MASTER';
    if (desc.includes('FREE')) return 'FREE_MONEY';
    if (desc.includes('WESTERN')) return 'WESTERN_UNION';
    if (desc.includes('RIA')) return 'RIA';
    if (desc.includes('MONEYGRAM')) return 'MONEYGRAM';
    return 'LIQUIDE';
  }

  convertToInt(value) {
    if (typeof value === 'number') return Math.round(value * 100);
    if (typeof value === 'string') return Math.round(parseFloat(value) * 100);
    return Math.round(value * 100);
  }

  convertFromInt(value) {
    return Number(value) / 100;
  }

  // =====================================
  // CRÉATION ADMIN TRANSACTION
  // =====================================
  async createAdminTransaction(adminId, transactionData) {
    try {
      const {
        superviseurId, typeCompte, typeOperation, montant,
        partenaireId, partenaireNom, telephoneLibre, callerRole
      } = transactionData;

      const montantFloat = parseFloat(montant);
      if (isNaN(montantFloat) || montantFloat <= 0) throw new Error('Montant invalide');

      const montantInt = this.convertToInt(montantFloat);
      const isPartnerTransaction = !!(partenaireId || partenaireNom);

      if (!isPartnerTransaction && typeCompte) {
        const typeCompteUpper = typeCompte.toUpperCase();
        const typeActif = await AccountTypeService.isTypeActive(typeCompteUpper);
        if (!typeActif) {
          const label = await AccountTypeService.getTypeLabel(typeCompteUpper);
          throw new Error(`Le type de compte "${label}" est actuellement désactivé. Contactez l'administrateur.`);
        }

        const isSupervisorCall = callerRole === 'SUPERVISEUR';
        if (isSupervisorCall && typeOperation === 'depot') {
          const canDebut = await AccountTypeService.canEnterDebut(typeCompteUpper);
          if (!canDebut) {
            const label = await AccountTypeService.getTypeLabel(typeCompteUpper);
            throw new Error(`La saisie du solde de début n'est pas autorisée pour le compte "${label}". Seule la saisie de fin est permise pour ce type.`);
          }
        } else if (isSupervisorCall && typeOperation === 'retrait') {
          const canFin = await AccountTypeService.canEnterFin(typeCompteUpper);
          if (!canFin) {
            const label = await AccountTypeService.getTypeLabel(typeCompteUpper);
            throw new Error(`La saisie du solde de fin n'est pas autorisée pour le compte "${label}". Seule la saisie de début est permise pour ce type.`);
          }
        }
      }

      const supervisor = await prisma.user.findUnique({
        where: { id: superviseurId, role: 'SUPERVISEUR' },
        select: { id: true, nomComplet: true, status: true }
      });

      if (!supervisor) throw new Error('Superviseur non trouvé');

      let partner = null;
      let partnerDisplayName = '';

      if (isPartnerTransaction) {
        if (partenaireId) {
          partner = await prisma.user.findUnique({
            where: { id: partenaireId, role: 'PARTENAIRE' },
            select: { id: true, nomComplet: true, status: true }
          });
          if (!partner) throw new Error('Partenaire enregistré non trouvé');
          partnerDisplayName = partner.nomComplet;
        } else if (partenaireNom) {
          partnerDisplayName = partenaireNom.trim();
          if (!partnerDisplayName || partnerDisplayName.length < 2) {
            throw new Error('Nom du partenaire invalide (minimum 2 caractères)');
          }
        }
      }

      if (isPartnerTransaction) {
        let transactionType, description;
        if (typeOperation === 'depot') {
          transactionType = 'DEPOT'; description = `Dépôt partenaire ${partnerDisplayName}`;
        } else {
          transactionType = 'RETRAIT'; description = `Retrait partenaire ${partnerDisplayName}`;
        }

        const result = await prisma.$transaction(async (tx) => {
          const txData = { montant: montantInt, type: transactionType, description, envoyeurId: adminId, destinataireId: superviseurId };
          if (partenaireId) { txData.partenaireId = partenaireId; }
          else if (partenaireNom) {
            txData.partenaireNom = partenaireNom.trim();
            if (telephoneLibre && telephoneLibre.trim()) txData.telephoneLibre = telephoneLibre.trim();
          }
          const transaction = await tx.transaction.create({
            data: txData,
            select: { id: true, type: true, description: true, createdAt: true, partenaireNom: true, telephoneLibre: true }
          });
          return { transaction, updatedAccount: null };
        });

        setImmediate(async () => {
          try {
            const notificationTitle = typeOperation === 'depot' ? 'Nouveau dépôt partenaire' : 'Nouveau retrait partenaire';
            const notificationMessage = typeOperation === 'depot'
              ? `${partnerDisplayName} a déposé ${this.formatAmount(montantFloat)}`
              : `${partnerDisplayName} a retiré ${this.formatAmount(montantFloat)}`;
            const notificationType = typeOperation === 'depot' ? 'DEPOT_PARTENAIRE' : 'RETRAIT_PARTENAIRE';
            await NotificationService.createNotification({ userId: superviseurId, title: notificationTitle, message: notificationMessage, type: notificationType });
          } catch (notifError) { console.error('Erreur notification (non-bloquante):', notifError); }
        });

        return {
          transaction: {
            id: result.transaction.id, type: result.transaction.type, montant: montantFloat,
            description: result.transaction.description, superviseurNom: supervisor.nomComplet,
            typeCompte: null, createdAt: result.transaction.createdAt,
            isPartnerTransaction: true, partnerName: partnerDisplayName,
            partnerId: partenaireId || null, partenaireNom: result.transaction.partenaireNom || null,
            telephoneLibre: result.transaction.telephoneLibre || null,
            isRegisteredPartner: !!partenaireId, transactionCategory: 'PARTENAIRE'
          },
          accountUpdated: false
        };

      } else {
        let account = await prisma.account.upsert({
          where: { userId_type: { userId: superviseurId, type: typeCompte.toUpperCase() } },
          update: {},
          create: { type: typeCompte.toUpperCase(), userId: superviseurId, balance: 0, initialBalance: 0 },
          select: { id: true, balance: true, initialBalance: true }
        });

        let transactionType, description, balanceUpdate;
        if (typeOperation === 'depot') {
          transactionType = 'DEBUT_JOURNEE'; description = `Début journée ${typeCompte}`;
          balanceUpdate = { initialBalance: { increment: montantInt } };
        } else {
          transactionType = 'FIN_JOURNEE'; description = `Fin journée ${typeCompte}`;
          balanceUpdate = { balance: montantInt };
        }

        const result = await prisma.$transaction(async (tx) => {
          const updatedAccount = await tx.account.update({
            where: { id: account.id }, data: balanceUpdate,
            select: { balance: true, initialBalance: true }
          });
          const transaction = await tx.transaction.create({
            data: { montant: montantInt, type: transactionType, description, envoyeurId: adminId, destinataireId: superviseurId, compteDestinationId: account.id },
            select: { id: true, type: true, description: true, createdAt: true }
          });
          return { transaction, updatedAccount };
        });

        setImmediate(async () => {
          try {
            const notificationTitle = typeOperation === 'depot' ? 'Solde de début mis à jour' : 'Solde de fin enregistré';
            const notificationType = typeOperation === 'depot' ? 'DEBUT_JOURNEE' : 'FIN_JOURNEE';
            await NotificationService.createNotification({ userId: superviseurId, title: notificationTitle, message: `${description} - ${this.formatAmount(montantFloat)} par l'admin`, type: notificationType });
          } catch (notifError) { console.error('Erreur notification (non-bloquante):', notifError); }
        });

        return {
          transaction: {
            id: result.transaction.id, type: result.transaction.type, montant: montantFloat,
            description: result.transaction.description, superviseurNom: supervisor.nomComplet,
            typeCompte, createdAt: result.transaction.createdAt,
            isPartnerTransaction: false, partnerName: null, partnerId: null,
            partenaireNom: null, isRegisteredPartner: false, transactionCategory: 'JOURNEE'
          },
          accountUpdated: true,
          soldeActuel: this.convertFromInt(result.updatedAccount.balance),
          soldeInitial: this.convertFromInt(result.updatedAccount.initialBalance)
        };
      }

    } catch (error) {
      console.error('Erreur createAdminTransaction:', error);
      throw error;
    }
  }

  // =====================================
  // PARTENAIRES LIBRES FRÉQUENTS
  // =====================================
  async getFrequentFreePartners(superviseurId = null, daysBack = 3, minTransactions = 3) {
    try {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      since.setHours(0, 0, 0, 0);

      const whereClause = {
        type: { in: ['DEPOT', 'RETRAIT'] }, partenaireId: null, partenaireNom: { not: null },
        createdAt: { gte: since }, OR: [{ archived: false }, { archived: null }]
      };
      if (superviseurId) whereClause.destinataireId = superviseurId;

      const transactions = await prisma.transaction.findMany({
        where: whereClause,
        select: { id: true, partenaireNom: true, telephoneLibre: true, montant: true, type: true, createdAt: true, destinataireId: true, destinataire: { select: { nomComplet: true } } },
        orderBy: { createdAt: 'desc' }
      });

      const grouped = {};
      transactions.forEach(tx => {
        const nom = tx.partenaireNom.trim().toLowerCase();
        const tel = tx.telephoneLibre?.trim() || null;
        const key = tel ? `${nom}||${tel}` : nom;
        if (!grouped[key]) { grouped[key] = { partenaireNom: tx.partenaireNom.trim(), telephoneLibre: tel, transactions: [], superviseurs: new Set() }; }
        grouped[key].transactions.push(tx);
        grouped[key].superviseurs.add(tx.destinataireId);
      });

      const frequent = Object.values(grouped)
        .filter(g => g.transactions.length >= minTransactions)
        .map(g => {
          const totalDepots   = g.transactions.filter(t => t.type === 'DEPOT').reduce((s, t) => s + this.convertFromInt(t.montant), 0);
          const totalRetraits = g.transactions.filter(t => t.type === 'RETRAIT').reduce((s, t) => s + this.convertFromInt(t.montant), 0);
          return { partenaireNom: g.partenaireNom, telephoneLibre: g.telephoneLibre, nombreTransactions: g.transactions.length, totalDepots, totalRetraits, derniereTransaction: g.transactions[0].createdAt, superviseurIds: [...g.superviseurs], peutConvertir: !!g.telephoneLibre };
        })
        .sort((a, b) => b.nombreTransactions - a.nombreTransactions);

      return frequent;

    } catch (error) {
      console.error('❌ [FREQUENT PARTNERS] Erreur:', error);
      throw error;
    }
  }

  async convertFreePartnerToAccount(partenaireNom, telephoneLibre, adminId) {
    try {
      if (!partenaireNom || partenaireNom.trim().length < 2) throw new Error('Nom du partenaire invalide');
      if (!telephoneLibre || telephoneLibre.trim().length < 6) throw new Error('Numéro de téléphone requis pour créer le compte');

      const tel = telephoneLibre.trim();
      const nom = partenaireNom.trim();

      const existing = await prisma.user.findUnique({ where: { telephone: tel } });
      if (existing) throw new Error(`Le numéro ${tel} est déjà utilisé par un compte existant`);

      const accessCode = Math.floor(100000 + Math.random() * 900000).toString();
      const bcrypt = await import('bcryptjs');
      const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
      const hashedCode = await bcrypt.hash(accessCode, saltRounds);

      const newUser = await prisma.user.create({
        data: { telephone: tel, nomComplet: nom, code: hashedCode, codeClair: accessCode, role: 'PARTENAIRE', status: 'ACTIVE' }
      });

      await prisma.notification.create({
        data: { userId: adminId, title: 'Partenaire créé', message: `${nom} a été enregistré comme partenaire. Code d'accès : ${accessCode}`, type: 'CREATION_UTILISATEUR' }
      });

      await prisma.transaction.updateMany({
        where: { partenaireNom: { equals: nom, mode: 'insensitive' }, partenaireId: null },
        data: { partenaireId: newUser.id }
      });

      console.log(`✅ [CONVERT PARTNER] ${nom} (${tel}) converti en partenaire`);

      return {
        user: { id: newUser.id, nomComplet: newUser.nomComplet, telephone: newUser.telephone, role: newUser.role, status: newUser.status, createdAt: newUser.createdAt },
        codeAcces: accessCode
      };

    } catch (error) {
      console.error('❌ [CONVERT PARTNER] Erreur:', error);
      throw error;
    }
  }

  // =====================================
  // SYSTÈME DE RESET
  // =====================================
  async cleanupDashboardAfterReset() {
    try {
      console.log('🧹 [CLEANUP] Nettoyage post-reset...');
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const resetConfig = this.getResetConfig();
      const todayResetTime = new Date(now);
      todayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
      const cleanupResult = await prisma.transaction.updateMany({
        where: { createdAt: { gte: startOfToday, lt: todayResetTime }, partenaireId: { not: null }, archived: { not: true } },
        data: { archived: true, archivedAt: now }
      });
      console.log(`✅ [CLEANUP] ${cleanupResult.count} transactions partenaires nettoyées`);
      return cleanupResult.count;
    } catch (error) {
      console.error('❌ [CLEANUP] Erreur:', error);
      throw error;
    }
  }

  async checkAndResetDaily() {
    try {
      const resetCheck = this.isInResetWindow();
      if (!resetCheck.isInWindow) {
        return { success: false, reason: 'outside_reset_window', currentTime: resetCheck.currentTime, resetWindow: `${resetCheck.resetTime} (${resetCheck.windowType})`, cronMessage: 'Reset géré par Vercel CRON à 00h00 UTC' };
      }

      const now = new Date();
      const dateKey = now.toDateString();
      const lastResetDate = await this.getLastResetDate();
      const resetConfig = this.getResetConfig();
      const resetHourMinute = `${resetConfig.hour}:${resetConfig.minute}`;
      const shouldReset = !lastResetDate || !lastResetDate.includes(dateKey) || lastResetDate.includes('ERROR') || !lastResetDate.includes(resetHourMinute);

      if (shouldReset) {
        try {
          const archivedCount = await this.archivePartnerTransactionsDynamic();
          await this.transferBalancesToInitial();
          const cleanedCount = await this.cleanupDashboardAfterReset();
          const resetKey = `${dateKey}-SUCCESS-${resetCheck.currentTime}-${resetHourMinute}-manual`;
          await this.saveResetDate(resetKey);
          const notificationResult = await this.notifyDashboardRefresh({ archivedCount, cleanedCount, executedAt: now.toISOString() });
          return { success: true, archivedCount, cleanedCount, executedAt: now.toISOString(), resetConfig: this.getResetConfig(), notifications: notificationResult, needsRefresh: true, type: 'manual' };
        } catch (resetError) {
          const errorKey = `${dateKey}-ERROR-${resetCheck.currentTime}`;
          await this.saveResetDate(errorKey);
          throw resetError;
        }
      } else {
        return { success: false, reason: 'already_executed_today', lastExecution: lastResetDate, currentTime: resetCheck.currentTime, cronMessage: 'Reset géré par Vercel CRON' };
      }
    } catch (error) {
      console.error('❌ [MANUAL RESET] Erreur checkAndResetDaily:', error);
      return { success: false, error: error.message, currentTime: new Date().toISOString() };
    }
  }

  getPartnerDisplayName(transaction) {
    if (transaction.partenaire?.nomComplet) return transaction.partenaire.nomComplet;
    if (transaction.partenaireNom) return transaction.partenaireNom;
    return 'Partenaire inconnu';
  }

  async archivePartnerTransactionsDynamic() {
    const { startOfYesterday, endOfYesterday } = this.getYesterdayRange();
    const result = await prisma.transaction.updateMany({
      where: {
        createdAt: { gte: startOfYesterday, lte: endOfYesterday },
        type: { in: ['DEPOT', 'RETRAIT'] },
        OR: [{ partenaireId: { not: null } }, { partenaireNom: { not: null } }],
        AND: [{ OR: [{ archived: false }, { archived: null }] }]
      },
      data: { archived: true, archivedAt: new Date() }
    });
    console.log(`✅ [DYNAMIC ARCHIVE] ${result.count} transactions archivées`, { start: startOfYesterday.toISOString(), end: endOfYesterday.toISOString() });
    return result.count;
  }

  // =====================================
  // RESET DES SOLDES — RÈGLE SIMPLIFIÉE
  // LIQUIDE  : fin → début, fin = 0
  // AUTRES   : début = 0, fin = 0
  // =====================================
  async transferBalancesToInitial() {
    try {
      console.log('🔄 [TRANSFER] Début du transfert des soldes...');

      // ── LIQUIDE : la fin devient le nouveau début, fin remise à 0 ──────────
      await prisma.$executeRaw`
        UPDATE "accounts"
        SET "previousInitialBalance" = "initialBalance",
            "initialBalance"         = balance,
            balance                  = 0
        WHERE type::text = 'LIQUIDE'
          AND "userId" IN (
            SELECT id FROM "users"
            WHERE role::text = 'SUPERVISEUR' AND status::text = 'ACTIVE'
          )
      `;
      console.log('✅ [TRANSFER] LIQUIDE : fin → début, fin = 0');

      // ── Tous les autres types fixes : début = 0, fin = 0 ──────────────────
      const otherTypes = [
        'ORANGE_MONEY', 'WAVE', 'UV_MASTER',
        'FREE_MONEY', 'WESTERN_UNION', 'RIA', 'MONEYGRAM'
      ];

      for (const type of otherTypes) {
        await prisma.$executeRaw`
          UPDATE "accounts"
          SET "previousInitialBalance" = "initialBalance",
              "initialBalance"         = 0,
              balance                  = 0
          WHERE type::text = ${type}
            AND "userId" IN (
              SELECT id FROM "users"
              WHERE role::text = 'SUPERVISEUR' AND status::text = 'ACTIVE'
            )
        `;
      }
      console.log('✅ [TRANSFER] Autres types fixes : début = 0, fin = 0');

      // ── Slots custom (AUTRES_*) : stockés en TEXT, pas d'enum ─────────────
      const customSlotConfig = await prisma.systemConfig.findFirst({
        where: { key: 'custom_account_slots' }
      });

      if (customSlotConfig?.value) {
        const slots = JSON.parse(customSlotConfig.value);
        for (const slot of slots) {
          await prisma.$executeRaw`
            UPDATE "accounts"
            SET "previousInitialBalance" = "initialBalance",
                "initialBalance"         = 0,
                balance                  = 0
            WHERE type::text = ${slot.id}
              AND "userId" IN (
                SELECT id FROM "users"
                WHERE role::text = 'SUPERVISEUR' AND status::text = 'ACTIVE'
              )
          `;
        }
        console.log(`✅ [TRANSFER] ${slots.length} slot(s) custom : début = 0, fin = 0`);
      }

      console.log('✅ [TRANSFER] Transfert terminé');

    } catch (error) {
      console.error('❌ [TRANSFER] Erreur transferBalancesToInitial:', error);
      throw error;
    }
  }

  async getLastResetDate() {
    try {
      const config = await prisma.systemConfig.findFirst({ where: { key: 'last_reset_date' }, select: { value: true } });
      if (config) return config.value;
    } catch (error) {
      console.log('[RESET] Table systemConfig non disponible, utilisation alternative');
    }
    try {
      const lastReset = await prisma.transaction.findFirst({
        where: { type: 'AUDIT_MODIFICATION', description: { contains: '[SYSTEM RESET]' } },
        orderBy: { createdAt: 'desc' }, select: { description: true }
      });
      return lastReset?.description || null;
    } catch (error) {
      console.error('[RESET] Erreur getLastResetDate:', error);
      return null;
    }
  }

  async saveResetDate(dateString) {
    try {
      await prisma.systemConfig.upsert({ where: { key: 'last_reset_date' }, update: { value: dateString }, create: { key: 'last_reset_date', value: dateString } });
    } catch (error) {
      try {
        const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
        await prisma.transaction.create({ data: { montant: 0, type: 'AUDIT_MODIFICATION', description: `[SYSTEM RESET] ${dateString}`, envoyeurId: adminUser?.id || 'cmffpzf8e0000248t0hu4w1gr' } });
      } catch (altError) {
        console.error('[RESET] Erreur saveResetDate (alternative):', altError);
      }
    }
  }

  async forceReset(adminId = 'vercel-cron') {
    try {
      console.log(`🤖 [CRON RESET ${adminId.toUpperCase()}] Lancement du reset automatique...`);
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      console.log('📸 [CRON RESET] Étape 0/5 - Création des snapshots quotidiens...');
      const snapshotResult = await this.createSnapshotsForAllSupervisors(yesterday);
      console.log('📦 [CRON RESET] Étape 1/5 - Archivage des transactions partenaires...');
      const archivedCount = await this.archivePartnerTransactionsDynamic();
      console.log('💰 [CRON RESET] Étape 2/5 - Transfert des soldes...');
      await this.transferBalancesToInitial();
      console.log('🧹 [CRON RESET] Étape 3/5 - Nettoyage des données...');
      const cleanedCount = await this.cleanupDashboardAfterReset();
      console.log('💾 [CRON RESET] Étape 4/5 - Enregistrement du reset...');
      const resetKey = `${now.toDateString()}-SUCCESS-${now.getHours()}h${now.getMinutes()}-${adminId}`;
      await this.saveResetDate(resetKey);

      const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
      await prisma.transaction.create({ data: { montant: 0, type: 'AUDIT_MODIFICATION', description: `Reset automatique ${adminId} - ${snapshotResult.successful} snapshots, ${archivedCount} archivées, ${cleanedCount} nettoyées`, envoyeurId: adminUser?.id || 'cmffpzf8e0000248t0hu4w1gr' } });

      console.log('📢 [CRON RESET] Étape 5/5 - Envoi des notifications...');
      const notificationResult = await this.notifyDashboardRefresh({ archivedCount, cleanedCount, snapshotsCreated: snapshotResult.successful, executedAt: now.toISOString() });

      return { success: true, snapshotsCreated: snapshotResult.successful, archivedCount, cleanedCount, executedAt: now.toISOString(), type: adminId, notifications: notificationResult, message: `Reset automatique ${adminId} exécuté avec succès à ${now.toISOString()}` };

    } catch (error) {
      console.error(`❌ [CRON RESET ${adminId.toUpperCase()}] Erreur:`, error);
      try {
        const now = new Date();
        await this.saveResetDate(`${now.toDateString()}-ERROR-${now.getHours()}h${now.getMinutes()}-${adminId}`);
      } catch (saveError) {
        console.error('❌ [CRON RESET] Impossible de sauvegarder l\'erreur:', saveError);
      }
      throw error;
    }
  }

  validateAdminTransactionData(data) {
    const errors = [];
    if (!data.superviseurId) errors.push('Superviseur requis');
    const hasPartenaireId  = !!data.partenaireId;
    const hasPartenaireNom = !!data.partenaireNom;
    const isPartnerTransaction = hasPartenaireId || hasPartenaireNom;
    if (hasPartenaireId && hasPartenaireNom) errors.push('Choisissez soit un partenaire enregistré, soit un nom libre (pas les deux)');
    if (!isPartnerTransaction && !data.typeCompte) errors.push('Type de compte requis pour transactions début/fin journée');
    if (!data.typeOperation) errors.push('Type d\'opération requis');
    if (!data.montant || data.montant <= 0) errors.push('Montant doit être supérieur à 0');
    if (hasPartenaireNom) {
      const nomTrimmed = data.partenaireNom.trim();
      if (nomTrimmed.length < 2) errors.push('Nom du partenaire doit contenir au moins 2 caractères');
      if (nomTrimmed.length > 100) errors.push('Nom du partenaire trop long (maximum 100 caractères)');
    }
    return errors;
  }

  // =====================================
  // MÉTHODES DASHBOARD
  // =====================================
  async getAdminDashboard(period = 'today', customDate = null) {
    try {
      console.log(`📊 [ADMIN DASHBOARD] Période: ${period}, Date: ${customDate}`);

      const dateFilter = this.getDateFilter(period, customDate);
      const includeArchived = await this.shouldIncludeArchivedTransactions(period, customDate);

      const { type: featuredType, label: featuredLabel } = await AccountTypeService.getFeaturedType();
      console.log(`⭐ [FEATURED] Type vedette: ${featuredType} ("${featuredLabel}")`);

      let snapshotDate = null;
      if (includeArchived) {
        if (period === 'yesterday') {
          snapshotDate = new Date();
          snapshotDate.setDate(snapshotDate.getDate() - 1);
          snapshotDate.setHours(0, 0, 0, 0);
        } else if (period === 'custom' && customDate) {
          snapshotDate = new Date(customDate);
          snapshotDate.setHours(0, 0, 0, 0);
        }
      }

      let transactionFilter = { createdAt: dateFilter };
      if (!snapshotDate) {
        transactionFilter = {
          ...transactionFilter,
          OR: [{ archived: { equals: false } }, { archived: { equals: null } }]
        };
      }

      const excludeDeleted = { NOT: { description: { startsWith: '[SUPPRIMÉ]' } } };

      const supervisors = await prisma.user.findMany({
        where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
        select: {
          id: true, nomComplet: true, status: true,
          accounts: {
            select: { type: true, balance: true, initialBalance: true, previousInitialBalance: true }
          },
          transactionsRecues: {
            where: { ...transactionFilter, ...excludeDeleted },
            select: {
              id: true, type: true, montant: true,
              partenaireId: true, partenaireNom: true,
              archived: true, archivedAt: true, createdAt: true,
              partenaire: { select: { nomComplet: true } }
            }
          }
        },
        orderBy: { nomComplet: 'asc' }
      });

      let totalDebutGlobal = 0, totalSortieGlobal = 0;
      let featuredSolde = 0, featuredSorties = 0;

      const supervisorCards = await Promise.all(supervisors.map(async (supervisor) => {
        const accountsByType = { debut: {}, sortie: {} };

        if (snapshotDate) {
          const snapshot = await this.getSnapshotForDate(supervisor.id, snapshotDate);
          if (snapshot) {
            Object.assign(accountsByType.debut, snapshot.comptes.debut);
            Object.assign(accountsByType.sortie, snapshot.comptes.sortie);

            supervisor.accounts.forEach(account => {
              if (account.type.startsWith('AUTRES_')) {
                const ancienDebut  = this.convertFromInt(account.previousInitialBalance || 0);
                const ancienSortie = this.convertFromInt(account.initialBalance || 0);
                accountsByType.debut[account.type]  = ancienDebut;
                accountsByType.sortie[account.type] = ancienSortie;
              }
            });

            const snapshotDebut  = snapshot.comptes.debut[featuredType]  ?? 0;
            const snapshotSortie = snapshot.comptes.sortie[featuredType] ?? 0;
            featuredSolde   += snapshotDebut;
            featuredSorties += snapshotSortie;

          } else {
            supervisor.accounts.forEach(account => {
              const ancienDebut  = this.convertFromInt(account.previousInitialBalance || 0);
              const ancienSortie = this.convertFromInt(account.initialBalance || 0);
              accountsByType.debut[account.type]  = ancienDebut;
              accountsByType.sortie[account.type] = ancienSortie;
              if (account.type === featuredType) {
                featuredSolde   += ancienDebut;
                featuredSorties += ancienSortie;
              }
            });
          }
        } else {
          supervisor.accounts.forEach(account => {
            const initial = this.convertFromInt(account.initialBalance || 0);
            const current = this.convertFromInt(account.balance || 0);
            accountsByType.debut[account.type]  = initial;
            accountsByType.sortie[account.type] = current;
            if (account.type === featuredType) {
              featuredSolde   += initial;
              featuredSorties += current;
            }
          });
        }

        const partenaireTransactions = {};
        let partnerTxSource = supervisor.transactionsRecues;

        if (snapshotDate) {
          const resetConfig = this.getResetConfig();
          const dayStart = new Date(snapshotDate);
          dayStart.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
          const dayEnd = new Date(dayStart);
          dayEnd.setDate(dayEnd.getDate() + 1);
          dayEnd.setTime(dayEnd.getTime() - 1000);

          partnerTxSource = await prisma.transaction.findMany({
            where: {
              destinataireId: supervisor.id, type: { in: ['DEPOT', 'RETRAIT'] },
              archived: true, createdAt: { gte: dayStart, lte: dayEnd },
              OR: [{ partenaireId: { not: null } }, { partenaireNom: { not: null } }],
              NOT: { description: { startsWith: '[SUPPRIMÉ]' } }
            },
            select: { id: true, type: true, montant: true, partenaireId: true, partenaireNom: true, partenaire: { select: { nomComplet: true } } }
          });
        }

        partnerTxSource.forEach(tx => {
          const partnerName = this.getPartnerDisplayName(tx);
          if (partnerName && partnerName !== 'Partenaire inconnu') {
            const montant = this.convertFromInt(tx.montant);
            if (!partenaireTransactions[partnerName]) {
              partenaireTransactions[partnerName] = { depots: 0, retraits: 0, isRegistered: !!tx.partenaireId };
            }
            if (tx.type === 'DEPOT')        partenaireTransactions[partnerName].depots   += montant;
            else if (tx.type === 'RETRAIT') partenaireTransactions[partnerName].retraits += montant;
          }
        });

        Object.entries(partenaireTransactions).forEach(([partnerName, amounts]) => {
          if (amounts.depots   > 0) accountsByType.debut[`part-${partnerName}`]  = amounts.depots;
          if (amounts.retraits > 0) accountsByType.sortie[`part-${partnerName}`] = amounts.retraits;
        });

        const debutTotal  = Object.values(accountsByType.debut).reduce((s, v) => s + v, 0);
        const sortieTotal = Object.values(accountsByType.sortie).reduce((s, v) => s + v, 0);
        const grTotal     = sortieTotal - debutTotal;

        totalDebutGlobal  += debutTotal;
        totalSortieGlobal += sortieTotal;

        return {
          id: supervisor.id, nom: supervisor.nomComplet, status: supervisor.status,
          comptes: accountsByType,
          totaux: {
            debutTotal, sortieTotal, grTotal,
            formatted: {
              debutTotal:  this.formatAmount(debutTotal),
              sortieTotal: this.formatAmount(sortieTotal),
              grTotal:     this.formatAmount(grTotal, true)
            }
          }
        };
      }));

      const globalTotals = {
        featured: {
          type:    featuredType,
          label:   featuredLabel,
          solde:   featuredSolde,
          sorties: featuredSorties,
          formatted: {
            solde:   this.formatAmount(featuredSolde),
            sorties: this.formatAmount(featuredSorties)
          }
        },
        uvMaster: {
          solde:   featuredSolde,
          sorties: featuredSorties,
          formatted: {
            solde:   this.formatAmount(featuredSolde),
            sorties: this.formatAmount(featuredSorties)
          }
        },
        debutTotalGlobal:  totalDebutGlobal,
        sortieTotalGlobal: totalSortieGlobal,
        grTotalGlobal:     totalSortieGlobal - totalDebutGlobal,
        formatted: {
          debutTotalGlobal:  this.formatAmount(totalDebutGlobal),
          sortieTotalGlobal: this.formatAmount(totalSortieGlobal),
          grTotalGlobal:     this.formatAmount(totalSortieGlobal - totalDebutGlobal, true)
        }
      };

      return {
        period, customDate, globalTotals, supervisorCards,
        dynamicConfig: {
          resetConfig:    this.getResetConfig(),
          includeArchived,
          targetDateTime: customDate,
          filterApplied:  includeArchived ? 'archived_included' : 'archived_excluded',
          dataSource:     snapshotDate ? 'historical_snapshot' : 'current_live',
          snapshotDate:   snapshotDate?.toISOString().split('T')[0],
          featuredType,
          featuredLabel,
          cronStatus:     'Vercel CRON géré automatiquement'
        }
      };

    } catch (error) {
      console.error('Erreur getAdminDashboard:', error);
      throw error;
    }
  }

  async getSupervisorDashboard(superviseurId, period = 'today', customDate = null) {
    try {
      const dateFilter = this.getDateFilter(period, customDate);
      const includeArchived = await this.shouldIncludeArchivedTransactions(period, customDate);

      const { type: featuredType, label: featuredLabel } = await AccountTypeService.getFeaturedType();

      const resetConfig = this.getResetConfig();
      const now = new Date();
      const todayResetTime = new Date(now);
      todayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);

      let transactionFilter = {};

      if (includeArchived) {
        const targetDate = (period === 'custom' && customDate)
          ? new Date(customDate)
          : (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; })();

        const targetDayStart = new Date(targetDate);
        targetDayStart.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
        const targetDayEnd = new Date(targetDayStart);
        targetDayEnd.setDate(targetDayEnd.getDate() + 1);
        targetDayEnd.setTime(targetDayEnd.getTime() - 1000);

        transactionFilter = {
          createdAt: { gte: targetDayStart, lte: targetDayEnd },
          AND: [{ OR: [{ envoyeurId: superviseurId }, { destinataireId: superviseurId }] }],
          archived: true,
          OR: [{ partenaireId: { not: null } }, { partenaireNom: { not: null } }]
        };
      } else {
        transactionFilter = {
          createdAt: dateFilter,
          AND: [
            { OR: [{ envoyeurId: superviseurId }, { destinataireId: superviseurId }] },
            { OR: [{ archived: false }, { archived: null }] }
          ]
        };
      }

      const [supervisor, allTransactions, featuredAccounts] = await Promise.all([
        prisma.user.findUnique({
          where: { id: superviseurId },
          select: {
            id: true, nomComplet: true, status: true,
            accounts: { select: { type: true, balance: true, initialBalance: true, previousInitialBalance: true } }
          }
        }),
        prisma.transaction.findMany({
          where: { ...transactionFilter, NOT: { description: { startsWith: '[SUPPRIMÉ]' } } },
          select: {
            id: true, type: true, montant: true, description: true, createdAt: true,
            envoyeurId: true, destinataireId: true, partenaireId: true,
            partenaireNom: true, archived: true,
            destinataire: { select: { nomComplet: true } },
            envoyeur:     { select: { nomComplet: true } },
            partenaire:   { select: { nomComplet: true } }
          },
          orderBy: { createdAt: 'desc' },
          take: 50
        }),
        prisma.account.findMany({
          where: { type: featuredType, user: { role: 'SUPERVISEUR', status: 'ACTIVE' } },
          select: { balance: true, initialBalance: true, previousInitialBalance: true }
        })
      ]);

      if (!supervisor) throw new Error('Superviseur non trouvé');

      if (period === 'custom' && allTransactions.length === 0) {
        return {
          superviseur: { id: supervisor.id, nom: supervisor.nomComplet, status: supervisor.status },
          period, customDate,
          featured: { type: featuredType, label: featuredLabel, personal: { debut: 0, sortie: 0, formatted: '0 F' }, total: 0, formatted: '0 F' },
          uvMaster: { personal: { debut: 0, sortie: 0, formatted: '0 F' }, total: 0, formatted: '0 F' },
          comptes: { debut: {}, sortie: {} },
          totaux: { debutTotal: 0, sortieTotal: 0, grTotal: 0, formatted: { debutTotal: '0 F', sortieTotal: '0 F', grTotal: '0 F' } },
          recentTransactions: [],
          dynamicConfig: { period, customDate, resetConfig: this.getResetConfig(), includeArchived, totalTransactionsFound: 0 }
        };
      }

      const accountsByType = { debut: {}, sortie: {} };
      let totalDebutPersonnel = 0, totalSortiePersonnel = 0;

      if (includeArchived && period === 'yesterday') {
        supervisor.accounts.forEach(account => {
          const ancienDebut  = this.convertFromInt(account.previousInitialBalance || 0);
          const ancienSortie = this.convertFromInt(account.initialBalance || 0);
          accountsByType.debut[account.type]  = ancienDebut;
          accountsByType.sortie[account.type] = ancienSortie;
          totalDebutPersonnel  += ancienDebut;
          totalSortiePersonnel += ancienSortie;
        });
      } else {
        supervisor.accounts.forEach(account => {
          const initial = this.convertFromInt(account.initialBalance || 0);
          const current = this.convertFromInt(account.balance || 0);
          accountsByType.debut[account.type]  = initial;
          accountsByType.sortie[account.type] = current;
          totalDebutPersonnel  += initial;
          totalSortiePersonnel += current;
        });
      }

      const partenaireTransactions = {};
      allTransactions.forEach(tx => {
        const partnerName = this.getPartnerDisplayName(tx);
        if (partnerName && partnerName !== 'Partenaire inconnu') {
          const montant = this.convertFromInt(tx.montant);
          if (!partenaireTransactions[partnerName]) partenaireTransactions[partnerName] = { depots: 0, retraits: 0 };
          if (tx.type === 'DEPOT'   && tx.destinataireId === superviseurId) partenaireTransactions[partnerName].depots   += montant;
          if (tx.type === 'RETRAIT' && tx.destinataireId === superviseurId) partenaireTransactions[partnerName].retraits += montant;
        }
      });

      Object.entries(partenaireTransactions).forEach(([partnerName, amounts]) => {
        if (amounts.depots   > 0) { accountsByType.debut[`part-${partnerName}`]  = amounts.depots;   totalDebutPersonnel  += amounts.depots;   }
        if (amounts.retraits > 0) { accountsByType.sortie[`part-${partnerName}`] = amounts.retraits; totalSortiePersonnel += amounts.retraits; }
      });

      let featuredDebut, featuredSortie;
      if (includeArchived && period === 'yesterday') {
        featuredDebut  = featuredAccounts.reduce((t, a) => t + this.convertFromInt(a.previousInitialBalance || 0), 0);
        featuredSortie = featuredAccounts.reduce((t, a) => t + this.convertFromInt(a.initialBalance || 0), 0);
      } else {
        featuredDebut  = featuredAccounts.reduce((t, a) => t + this.convertFromInt(a.initialBalance || 0), 0);
        featuredSortie = featuredAccounts.reduce((t, a) => t + this.convertFromInt(a.balance || 0), 0);
      }

      const grTotal = totalSortiePersonnel - totalDebutPersonnel;

      const recentTransactions = allTransactions.map(tx => {
        let personne = '';
        if (tx.partenaireId || tx.partenaireNom) {
          personne = `${this.getPartnerDisplayName(tx)} (Partenaire)`;
        } else if (tx.envoyeurId === superviseurId) {
          personne = tx.destinataire?.nomComplet || 'Destinataire inconnu';
        } else if (tx.destinataireId === superviseurId) {
          personne = tx.envoyeur?.nomComplet || 'Expéditeur inconnu';
        }
        if (['DEBUT_JOURNEE', 'FIN_JOURNEE'].includes(tx.type)) personne = supervisor.nomComplet;
        return {
          id: tx.id, type: tx.type, montant: this.convertFromInt(tx.montant),
          description: tx.description, personne, createdAt: tx.createdAt,
          envoyeurId: tx.envoyeurId, destinataireId: tx.destinataireId,
          partenaireId: tx.partenaireId, partenaireNom: tx.partenaireNom,
          archived: tx.archived
        };
      });

      const featuredFormatted = featuredSortie.toLocaleString() + ' F';

      return {
        superviseur: { id: supervisor.id, nom: supervisor.nomComplet, status: supervisor.status },
        period, customDate,
        featured: {
          type:    featuredType,
          label:   featuredLabel,
          personal: { debut: featuredDebut, sortie: featuredSortie, formatted: featuredFormatted },
          total:   featuredSortie,
          formatted: featuredFormatted
        },
        uvMaster: {
          personal: { debut: featuredDebut, sortie: featuredSortie, formatted: featuredFormatted },
          total:    featuredSortie,
          formatted: featuredFormatted
        },
        comptes: accountsByType,
        totaux: {
          debutTotal: totalDebutPersonnel, sortieTotal: totalSortiePersonnel, grTotal,
          formatted: {
            debutTotal:  totalDebutPersonnel.toLocaleString() + ' F',
            sortieTotal: totalSortiePersonnel.toLocaleString() + ' F',
            grTotal:     this.formatAmount(grTotal, true)
          }
        },
        recentTransactions,
        dynamicConfig: {
          period, customDate, resetConfig: this.getResetConfig(), includeArchived,
          totalTransactionsFound: allTransactions.length,
          filterApplied:  includeArchived ? 'archived_included' : 'archived_excluded',
          dataSource:     includeArchived ? 'historical_after_reset' : 'current_live',
          featuredType,
          featuredLabel
        }
      };

    } catch (error) {
      console.error('Erreur getSupervisorDashboard:', error);
      throw new Error('Erreur lors de la récupération du dashboard superviseur: ' + error.message);
    }
  }

  async getPartnerDashboard(partenaireId, period = 'today', customDate = null) {
    try {
      const dateFilter = this.getDateFilter(period, customDate);
      const [partner, availableSupervisors] = await Promise.all([
        prisma.user.findUnique({
          where: { id: partenaireId },
          select: {
            id: true, nomComplet: true,
            transactionsEnvoyees: {
              where: { createdAt: dateFilter },
              select: { id: true, type: true, montant: true, description: true, createdAt: true, destinataire: { select: { nomComplet: true, role: true } } },
              orderBy: { createdAt: 'desc' }
            }
          }
        }),
        this.getActiveSupervisors()
      ]);

      if (!partner) throw new Error('Partenaire non trouvé');

      let totalDepots = 0, totalRetraits = 0;
      const transactionDetails = partner.transactionsEnvoyees.map(tx => {
        const montant = this.convertFromInt(tx.montant);
        const isDepot = tx.type === 'DEPOT';
        if (isDepot) totalDepots += montant; else totalRetraits += montant;
        return { id: tx.id, type: tx.type, montant, description: tx.description, superviseur: tx.destinataire?.nomComplet, createdAt: tx.createdAt, formatted: { montant: this.formatAmount(montant), type: isDepot ? 'Dépôt' : 'Retrait' } };
      });

      return {
        partenaire: { id: partner.id, nom: partner.nomComplet },
        period, customDate,
        statistiques: {
          totalDepots, totalRetraits, soldeNet: totalDepots - totalRetraits,
          nombreTransactions: partner.transactionsEnvoyees.length,
          formatted: { totalDepots: this.formatAmount(totalDepots), totalRetraits: this.formatAmount(totalRetraits), soldeNet: this.formatAmount(totalDepots - totalRetraits, true) }
        },
        transactions: transactionDetails,
        superviseursDisponibles: availableSupervisors
      };

    } catch (error) {
      console.error('Erreur getPartnerDashboard:', error);
      throw new Error('Erreur lors de la récupération du dashboard partenaire');
    }
  }

  async updateTransaction(transactionId, updateData, userId) {
    try {
      if (!transactionId || !updateData || Object.keys(updateData).length === 0) throw new Error('Données invalides');

      const [existingTransaction, user] = await Promise.all([
        prisma.transaction.findUnique({
          where: { id: transactionId },
          select: {
            id: true, type: true, montant: true, description: true, createdAt: true,
            envoyeurId: true, destinataireId: true, compteDestinationId: true,
            partenaireId: true, partenaireNom: true, archived: true, archivedAt: true,
            envoyeur:          { select: { id: true, nomComplet: true, role: true } },
            destinataire:      { select: { id: true, nomComplet: true, role: true } },
            compteDestination: { select: { id: true, balance: true, initialBalance: true } }
          }
        }),
        prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, nomComplet: true } })
      ]);

      if (!existingTransaction) throw new Error('Transaction non trouvée');
      if (!user) throw new Error('Utilisateur non trouvé');

      const isAdmin      = user.role === 'ADMIN';
      const isSupervisor = user.role === 'SUPERVISEUR';
      const isOwnTransaction = existingTransaction.destinataireId === userId;
      const ageInDays = Math.floor((new Date() - new Date(existingTransaction.createdAt)) / (1000 * 60 * 60 * 24));

      if (!isAdmin && (!isSupervisor || !isOwnTransaction || ageInDays > 1)) throw new Error('Permissions insuffisantes pour modifier cette transaction');
      if (isAdmin && ageInDays > 7) throw new Error('Transaction trop ancienne pour être modifiée (limite: 7 jours)');

      const isPartnerTransaction = !!(existingTransaction.partenaireId || existingTransaction.partenaireNom);
      const updateFields = {};

      if (updateData.description) updateFields.description = updateData.description;

      if (updateData.montant) {
        const newMontantFloat = parseFloat(updateData.montant);
        if (isNaN(newMontantFloat) || newMontantFloat <= 0) throw new Error('Montant invalide');

        const newMontantInt = this.convertToInt(newMontantFloat);
        const oldMontantInt = Number(existingTransaction.montant);
        updateFields.montant = newMontantInt;

        if (isPartnerTransaction) {
          const result = await prisma.$transaction(async (tx) => {
            const updatedTransaction = await tx.transaction.update({
              where: { id: transactionId },
              data: { ...updateFields, archived: existingTransaction.archived ?? false, archivedAt: existingTransaction.archivedAt ?? null }
            });
            await tx.transaction.create({ data: { montant: newMontantInt, type: 'AUDIT_MODIFICATION', description: `Modification transaction partenaire ${transactionId} - Ancien: ${this.convertFromInt(oldMontantInt)} F, Nouveau: ${newMontantFloat} F - par ${user.nomComplet}`, envoyeurId: userId, destinataireId: existingTransaction.destinataireId } });
            return updatedTransaction;
          });

          setImmediate(async () => {
            try {
              const dateStr = new Date(existingTransaction.createdAt).toISOString().split('T')[0];
              await this.recomputeAndSaveSnapshot(existingTransaction.destinataireId, dateStr);
              console.log(`✅ Snapshot recomputed pour ${dateStr} après modification partenaire`);
            } catch (snapshotError) { console.error('⚠️ Erreur recompute snapshot (non bloquant):', snapshotError); }
          });

          return { success: true, message: 'Transaction partenaire mise à jour avec succès', data: { id: result.id, type: result.type, montant: this.convertFromInt(result.montant), description: result.description, updatedAt: result.updatedAt } };
        }

        if (existingTransaction.compteDestination && newMontantInt !== oldMontantInt) {
          const difference = newMontantInt - oldMontantInt;
          return await prisma.$transaction(async (tx) => {
            if (existingTransaction.type === 'DEBUT_JOURNEE') {
              await tx.account.update({ where: { id: existingTransaction.compteDestination.id }, data: { initialBalance: { increment: difference } } });
            } else if (existingTransaction.type === 'FIN_JOURNEE') {
              await tx.account.update({ where: { id: existingTransaction.compteDestination.id }, data: { balance: { increment: difference } } });
            } else if (existingTransaction.type === 'RETRAIT') {
              if (existingTransaction.compteDestination.balance - difference < 0) throw new Error('Solde insuffisant pour cette modification');
              await tx.account.update({ where: { id: existingTransaction.compteDestination.id }, data: { balance: { decrement: difference } } });
            } else if (existingTransaction.type === 'DEPOT') {
              await tx.account.update({ where: { id: existingTransaction.compteDestination.id }, data: { balance: { increment: difference } } });
            }
            const updatedTransaction = await tx.transaction.update({ where: { id: transactionId }, data: updateFields });
            await tx.transaction.create({ data: { montant: newMontantInt, type: 'AUDIT_MODIFICATION', description: `Modification transaction ${transactionId} par ${user.nomComplet} - Ancien: ${this.convertFromInt(oldMontantInt)} F, Nouveau: ${newMontantFloat} F`, envoyeurId: userId, destinataireId: existingTransaction.destinataireId } });
            return updatedTransaction;
          });
        }
      }

      const updatedTransaction = await prisma.transaction.update({
        where: { id: transactionId },
        data: { ...updateFields, ...(isPartnerTransaction && { archived: existingTransaction.archived ?? false, archivedAt: existingTransaction.archivedAt ?? null }) }
      });

      if (isPartnerTransaction) {
        setImmediate(async () => {
          try {
            const dateStr = new Date(existingTransaction.createdAt).toISOString().split('T')[0];
            await this.recomputeAndSaveSnapshot(existingTransaction.destinataireId, dateStr);
          } catch (e) { console.error('⚠️ Erreur recompute snapshot:', e); }
        });
      }

      return { success: true, message: 'Transaction mise à jour avec succès', data: { id: updatedTransaction.id, type: updatedTransaction.type, montant: this.convertFromInt(updatedTransaction.montant), description: updatedTransaction.description, updatedAt: updatedTransaction.updatedAt } };

    } catch (error) {
      console.error('❌ Erreur updateTransaction:', error);
      throw error;
    }
  }

  async updateSupervisorAccount(supervisorId, accountType, accountKey, newValue, adminId) {
    try {
      const newValueInt = this.convertToInt(newValue);
      const supervisor = await prisma.user.findUnique({ where: { id: supervisorId, role: 'SUPERVISEUR' }, select: { id: true, nomComplet: true } });
      if (!supervisor) throw new Error('Superviseur non trouvé');

      if (!accountKey.startsWith('part-') && !accountKey.startsWith('sup-')) {
        const account = await prisma.account.upsert({
          where: { userId_type: { userId: supervisorId, type: accountKey } },
          update: accountType === 'debut' ? { initialBalance: newValueInt } : { balance: newValueInt },
          create: { type: accountKey, userId: supervisorId, balance: accountType === 'sortie' ? newValueInt : 0, initialBalance: accountType === 'debut' ? newValueInt : 0 },
          select: { id: true, balance: true, initialBalance: true }
        });
        const oldValue = accountType === 'debut' ? this.convertFromInt(account.initialBalance) : this.convertFromInt(account.balance);
        setImmediate(async () => {
          try {
            await prisma.transaction.create({ data: { montant: newValueInt, type: 'AUDIT_MODIFICATION', description: `Modification compte ${accountKey} (${accountType}) par admin - Ancien: ${oldValue} F, Nouveau: ${newValue} F`, envoyeurId: adminId, destinataireId: supervisorId, compteDestinationId: account.id } });
          } catch (auditError) { console.error('Erreur audit (non-bloquante):', auditError); }
        });
        return { oldValue, newValue, accountUpdated: true };
      } else {
        setImmediate(async () => {
          try {
            await prisma.transaction.create({ data: { montant: newValueInt, type: 'AUDIT_MODIFICATION', description: `Tentative modification compte ${accountKey} (${accountType}) par admin`, envoyeurId: adminId, destinataireId: supervisorId } });
          } catch (auditError) { console.error('Erreur audit (non-bloquante):', auditError); }
        });
        return { oldValue: 0, newValue, note: 'Modification enregistrée (comptes partenaires)' };
      }
    } catch (error) {
      console.error('❌ Erreur updateSupervisorAccount service:', error);
      throw error;
    }
  }

  async getActiveSupervisors() {
    try {
      return await prisma.user.findMany({
        where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
        select: { id: true, nomComplet: true, telephone: true },
        orderBy: { nomComplet: 'asc' }
      });
    } catch (error) {
      throw new Error('Erreur lors de la récupération des superviseurs actifs');
    }
  }

  async createSupervisorTransaction(superviseurId, transactionData) {
    try {
      return await this.createAdminTransaction(superviseurId, { ...transactionData, superviseurId, callerRole: 'SUPERVISEUR' });
    } catch (error) { throw error; }
  }

  async createPartnerTransaction(partnerId, transactionData) {
    throw new Error('Fonctionnalité createPartnerTransaction à implémenter');
  }

  getAccountTypeLabel(type, autresLabel = 'Autres') {
    const labels = { 'LIQUIDE': 'Liquide', 'ORANGE_MONEY': 'Orange Money', 'WAVE': 'Wave', 'UV_MASTER': 'UV Master', 'FREE_MONEY': 'Free Money', 'WESTERN_UNION': 'Western Union', 'RIA': 'Ria', 'MONEYGRAM': 'MoneyGram', 'AUTRES': autresLabel };
    return labels[type] || type;
  }

  getAccountTypeIcon(type) {
    const icons = { 'LIQUIDE': '💵', 'ORANGE_MONEY': '📱', 'WAVE': '🌊', 'UV_MASTER': '⭐', 'FREE_MONEY': '📲', 'WESTERN_UNION': '🌍', 'RIA': '💳', 'MONEYGRAM': '💰', 'AUTRES': '📦' };
    return icons[type] || '📦';
  }

  getTransactionTypeLabel(type) {
    const labels = { 'DEPOT': 'Dépôt', 'RETRAIT': 'Retrait', 'TRANSFERT_ENVOYE': 'Transfert envoyé', 'TRANSFERT_RECU': 'Transfert reçu', 'ALLOCATION_UV_MASTER': 'Allocation UV Master', 'DEBUT_JOURNEE': 'Début journée', 'FIN_JOURNEE': 'Fin journée' };
    return labels[type] || type;
  }

  getTransactionColor(type) {
    const positiveTypes = ['DEPOT', 'TRANSFERT_RECU', 'ALLOCATION_UV_MASTER', 'DEBUT_JOURNEE'];
    const negativeTypes = ['RETRAIT', 'TRANSFERT_ENVOYE', 'FIN_JOURNEE'];
    if (positiveTypes.includes(type)) return 'positive';
    if (negativeTypes.includes(type)) return 'negative';
    return 'neutral';
  }

  getPeriodLabel(period, customDate = null) {
    if (period === 'custom' && customDate) return this.formatDateForDisplay(customDate).long;
    const labels = { 'today': "Aujourd'hui", 'yesterday': "Hier", 'week': 'Cette semaine', 'month': 'Ce mois', 'year': 'Cette année', 'all': 'Tout' };
    return labels[period] || period;
  }

  async getAvailableDates(userId = null, role = null) {
    try {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      const snapshotDates = await prisma.dailySnapshot.findMany({
        where: { date: { gte: oneYearAgo }, ...(userId && { userId }) },
        select: { date: true }, distinct: ['date'], orderBy: { date: 'desc' }
      });

      let transactionFilter = { createdAt: { gte: oneYearAgo }, type: { in: ['DEPOT', 'RETRAIT', 'DEBUT_JOURNEE', 'FIN_JOURNEE'] } };
      if (userId && role === 'SUPERVISEUR') transactionFilter.OR = [{ destinataireId: userId }, { envoyeurId: userId }];

      const transactionDates = await prisma.transaction.findMany({
        where: transactionFilter, select: { createdAt: true }, orderBy: { createdAt: 'desc' }
      });

      const allDates = new Set();
      snapshotDates.forEach(snap => allDates.add(snap.date.toISOString().split('T')[0]));
      transactionDates.forEach(tx => allDates.add(new Date(tx.createdAt).toISOString().split('T')[0]));

      const sortedDates = Array.from(allDates).sort((a, b) => new Date(b) - new Date(a));

      return sortedDates.slice(0, 60).map(dateStr => {
        const formatted = this.formatDateForDisplay(dateStr);
        return { value: dateStr, display: formatted.short, displayLong: formatted.long, hasSnapshots: snapshotDates.some(snap => snap.date.toISOString().split('T')[0] === dateStr) };
      });

    } catch (error) {
      console.error('Erreur getAvailableDates:', error);
      return [];
    }
  }

  async testDateFiltering(testDate) {
    try {
      const validation = this.validateCustomDateTime(testDate);
      if (!validation.valid) return { error: validation.error };

      const dateFilter = this.getDateFilter('custom', testDate);
      const includeArchived = await this.shouldIncludeArchivedTransactions('custom', testDate);

      const testTransactions = await prisma.transaction.findMany({
        where: {
          createdAt: dateFilter,
          ...(includeArchived ? { archived: true } : { OR: [{ archived: { equals: false } }, { archived: { equals: null } }] })
        },
        select: { id: true, type: true, createdAt: true, archived: true, destinataire: { select: { nomComplet: true } } },
        take: 10, orderBy: { createdAt: 'desc' }
      });

      return { testDate, dateFilter: { start: dateFilter.gte.toISOString(), end: dateFilter.lte.toISOString() }, includeArchived, transactionsFound: testTransactions.length, sampleTransactions: testTransactions, resetConfig: this.getResetConfig() };

    } catch (error) {
      return { error: error.message };
    }
  }

  async setResetTimeForTesting(hour, minute) { this.setResetConfig(hour, minute, 0); }

  async testResetLogic() {
    const { isInWindow, currentTime, resetTime } = this.isInResetWindow();
    const { startOfYesterday, endOfYesterday } = this.getYesterdayRange();
    return { currentTime, resetTime, isInWindow, yesterdayRange: { start: startOfYesterday.toISOString(), end: endOfYesterday.toISOString() }, resetConfig: this.getResetConfig() };
  }

  async getResetStatus() {
    try {
      const now = new Date();
      const today = now.toDateString();
      const lastResetDate = await this.getLastResetDate();
      const resetConfig = this.getResetConfig();
      const resetToday = lastResetDate && lastResetDate.includes(today);
      const nextResetTime = new Date();
      nextResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);
      if (now > nextResetTime) nextResetTime.setDate(nextResetTime.getDate() + 1);
      return { resetExecutedToday: resetToday, lastReset: lastResetDate, nextScheduledReset: nextResetTime.toISOString(), currentTime: now.toISOString(), resetConfig, canExecuteNow: this.isInResetWindow().isInWindow, cronWorking: resetToday && lastResetDate.includes('vercel-cron') };
    } catch (error) { return { error: error.message }; }
  }

  async checkCronStatus() {
    try {
      const now = new Date();
      const today = now.toDateString();
      const lastResetDate = await this.getLastResetDate();
      const resetExecutedToday = lastResetDate && lastResetDate.includes(today) && lastResetDate.includes('SUCCESS');
      const isCronReset = lastResetDate && lastResetDate.includes('vercel-cron');
      return { cronWorking: resetExecutedToday && isCronReset, lastResetDate, resetExecutedToday, isCronReset, currentTime: now.toISOString(), message: resetExecutedToday ? (isCronReset ? 'CRON Vercel fonctionne correctement' : 'Reset manuel effectué aujourd\'hui') : 'Aucun reset effectué aujourd\'hui', nextCronExecution: '00:00 UTC (chaque nuit)' };
    } catch (error) { return { cronWorking: false, error: error.message }; }
  }

  async debugResetState() {
    try {
      const now = new Date();
      const resetConfig = this.getResetConfig();
      const todayResetTime = new Date(now);
      todayResetTime.setHours(resetConfig.hour, resetConfig.minute, 0, 0);

      const [resetStatus, cronStatus, recentTransactions, accountStates] = await Promise.all([
        this.getResetStatus(), this.checkCronStatus(),
        prisma.transaction.findMany({ where: { type: { in: ['DEPOT', 'RETRAIT'] }, partenaireId: { not: null } }, select: { id: true, type: true, createdAt: true, archived: true, archivedAt: true, partenaire: { select: { nomComplet: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
        prisma.account.findMany({ where: { user: { role: 'SUPERVISEUR', status: 'ACTIVE' } }, select: { type: true, balance: true, initialBalance: true, previousInitialBalance: true, user: { select: { nomComplet: true } } } })
      ]);

      return {
        currentTime: now.toISOString(), resetConfig, isAfterTodayReset: now > todayResetTime,
        resetStatus, cronStatus,
        recentTransactions: recentTransactions.map(tx => ({ type: tx.type, partner: tx.partenaire?.nomComplet, createdAt: tx.createdAt.toISOString(), archived: tx.archived, archivedAt: tx.archivedAt?.toISOString() })),
        accountStates: accountStates.map(acc => ({ user: acc.user.nomComplet, type: acc.type, balance: this.convertFromInt(acc.balance || 0), initialBalance: this.convertFromInt(acc.initialBalance || 0), previousInitialBalance: acc.previousInitialBalance ? this.convertFromInt(acc.previousInitialBalance) : null }))
      };
    } catch (error) { return { error: error.message }; }
  }
}

export default new TransactionService();