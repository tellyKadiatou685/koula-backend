// src/services/CumulService.js
import prisma from '../config/database.js';

const INTERNATIONAL_TYPES = ['WESTERN_UNION', 'RIA', 'MONEYGRAM'];

class CumulService {

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  generateDateRange(startDate, endDate) {
    const dates = [];
    const cursor = new Date(endDate);
    cursor.setHours(0, 0, 0, 0);
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    while (cursor >= start) {
      dates.push(cursor.toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() - 1);
    }
    return dates;
  }

  convertFromInt(value) { return Number(value) / 100; }

  convertToInt(value) { return Math.round(parseFloat(value) * 100); }

  async getSupervisors() {
    return prisma.user.findMany({
      where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
      select: { id: true, nomComplet: true }
    });
  }

  formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      weekday: 'short', day: '2-digit', month: 'short'
    });
  }

  // Extrait F1/F2 international depuis un snapshot brut (champs séparés)
  extractInternationalFromSnapshot(snapshot) {
    return {
      WESTERN_UNION: {
        f1:    this.convertFromInt(snapshot.westernUnionFin   || 0),
        f2:    0,
        debut: this.convertFromInt(snapshot.westernUnionDebut || 0)
      },
      RIA: {
        f1:    this.convertFromInt(snapshot.riaFin   || 0),
        f2:    0,
        debut: this.convertFromInt(snapshot.riaDebut || 0)
      },
      MONEYGRAM: {
        f1:    this.convertFromInt(snapshot.moneygramFin   || 0),
        f2:    0,
        debut: this.convertFromInt(snapshot.moneygramDebut || 0)
      }
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPER : charger tous les snapshots d'une plage en UNE requête
  // ══════════════════════════════════════════════════════════════════════════

  async loadAllSnapshots(supervisorIds, startDateStr, endDateStr) {
    const startDate = new Date(startDateStr);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);

    const snapshots = await prisma.dailySnapshot.findMany({
      where: {
        userId: { in: supervisorIds },
        date:   { gte: startDate, lte: endDate }
      },
      select: {
        userId: true, date: true,
        westernUnionDebut: true, westernUnionFin: true,
        riaDebut: true, riaFin: true,
        moneygramDebut: true, moneygramFin: true,
        liquideDebut: true, liquideFin: true,
        orangeMoneyDebut: true, orangeMoneyFin: true,
        waveDebut: true, waveFin: true,
        uvMasterDebut: true, uvMasterFin: true,
        autresDebut: true, autresFin: true,
        freeMoneyDebut: true, freeMoneyFin: true,
        debutTotal: true, sortieTotal: true, grTotal: true
      }
    });

    const f2Keys = [];
    for (const snap of snapshots) {
      const dateStr = snap.date.toISOString().split('T')[0];
      f2Keys.push(`snapshot_f2_${snap.userId}_${dateStr}`);
    }

    let f2Index = {};
    if (f2Keys.length > 0) {
      const f2Configs = await prisma.systemConfig.findMany({
        where:  { key: { in: f2Keys } },
        select: { key: true, value: true }
      });
      f2Configs.forEach(cfg => {
        try { f2Index[cfg.key] = JSON.parse(cfg.value); } catch { f2Index[cfg.key] = {}; }
      });
    }

    const index = {};
    for (const snap of snapshots) {
      const dateStr = snap.date.toISOString().split('T')[0];
      const key     = `${dateStr}_${snap.userId}`;
      const f2Data  = f2Index[`snapshot_f2_${snap.userId}_${dateStr}`] || {};
      index[key]    = { snap, f2Data };
    }

    console.log(`✅ [SNAPSHOT LOAD] ${snapshots.length} snapshots + ${Object.keys(f2Index).length} F2 chargés en 2 requêtes DB`);
    return index;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DONNÉES EN TEMPS RÉEL (aujourd'hui)
  // ══════════════════════════════════════════════════════════════════════════

  async getInternationalLive(dateStr) {
    try {
      console.log(`🌍 [INTL LIVE] Données temps réel pour ${dateStr}`);
      const supervisors = await this.getSupervisors();

      const totauxParOp = {
        WESTERN_UNION: { f1: 0, f2: 0, diff: 0 },
        RIA:           { f1: 0, f2: 0, diff: 0 },
        MONEYGRAM:     { f1: 0, f2: 0, diff: 0 }
      };
      const detailSups = [];

      const allAccounts = await Promise.all(
        supervisors.map(sup =>
          prisma.account.findMany({
            where:  { userId: sup.id },
            select: { type: true, balance: true, finSecondaire: true }
          }).then(accounts => ({ sup, accounts }))
        )
      );

      for (const { sup, accounts } of allAccounts) {
        const ops = {
          WESTERN_UNION: { f1: 0, f2: 0, diff: 0 },
          RIA:           { f1: 0, f2: 0, diff: 0 },
          MONEYGRAM:     { f1: 0, f2: 0, diff: 0 }
        };

        for (const account of accounts) {
          if (totauxParOp[account.type]) {
            const f1   = this.convertFromInt(account.balance       || 0);
            const f2   = this.convertFromInt(account.finSecondaire || 0);
            const diff = f2 - f1;

            ops[account.type].f1   += f1;
            ops[account.type].f2   += f2;
            ops[account.type].diff += diff;

            totauxParOp[account.type].f1   += f1;
            totauxParOp[account.type].f2   += f2;
            totauxParOp[account.type].diff += diff;
          }
        }

        const aDesDonnees = Object.values(ops).some(o => o.f1 > 0 || o.f2 > 0);
        if (aDesDonnees) {
          detailSups.push({ id: sup.id, nom: sup.nomComplet, ops, hasData: true });
        }
      }

      const totalGlobal = INTERNATIONAL_TYPES.reduce(
        (acc, t) => ({
          f1:   acc.f1   + totauxParOp[t].f1,
          f2:   acc.f2   + totauxParOp[t].f2,
          diff: acc.diff + totauxParOp[t].diff
        }),
        { f1: 0, f2: 0, diff: 0 }
      );

      return {
        success:          true,
        mode:             'date_unique',
        date:             dateStr,
        dateDisplay:      this.formatDate(dateStr) + ' (temps réel)',
        totauxParOperateur: totauxParOp,
        totalGlobal:      { ...totalGlobal, cumulativeTotal: totalGlobal.diff },
        parSuperviseur:   detailSups,
        isLiveData:       true
      };
    } catch (error) {
      console.error('❌ [INTL LIVE] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNATIONAL — SNAPSHOT DATE UNIQUE
  // ══════════════════════════════════════════════════════════════════════════

  async getInternationalByDate(dateStr) {
    try {
      const today = new Date().toISOString().split('T')[0];
      if (dateStr === today) return this.getInternationalLive(dateStr);

      console.log(`🌍 [INTL SNAPSHOT] ${dateStr}`);
      const supervisors = await this.getSupervisors();

      const snapshotIndex = await this.loadAllSnapshots(
        supervisors.map(s => s.id), dateStr, dateStr
      );

      const totauxParOp = {};
      INTERNATIONAL_TYPES.forEach(t => { totauxParOp[t] = { f1: 0, f2: 0, diff: 0 }; });
      const detailSups = [];

      for (const sup of supervisors) {
        const entry = snapshotIndex[`${dateStr}_${sup.id}`];
        const ops   = {};
        INTERNATIONAL_TYPES.forEach(t => { ops[t] = { f1: 0, f2: 0, diff: 0 }; });

        if (entry) {
          const { snap, f2Data } = entry;
          const raw = this.extractInternationalFromSnapshot(snap);

          for (const type of INTERNATIONAL_TYPES) {
            const f1    = raw[type].f1;
            const f2Raw = f2Data[type];
            const f2    = f2Raw !== undefined ? this.convertFromInt(BigInt(f2Raw)) : 0;
            const diff  = f2 - f1;

            ops[type] = { f1, f2, diff };
            totauxParOp[type].f1   += f1;
            totauxParOp[type].f2   += f2;
            totauxParOp[type].diff += diff;
          }
        }

        detailSups.push({ id: sup.id, nom: sup.nomComplet, ops, hasData: !!entry });
      }

      const totalGlobal = INTERNATIONAL_TYPES.reduce(
        (acc, t) => ({
          f1:   acc.f1   + totauxParOp[t].f1,
          f2:   acc.f2   + totauxParOp[t].f2,
          diff: acc.diff + totauxParOp[t].diff
        }),
        { f1: 0, f2: 0, diff: 0 }
      );

      return {
        success:            true,
        mode:               'date_unique',
        date:               dateStr,
        dateDisplay:        this.formatDate(dateStr),
        totauxParOperateur: totauxParOp,
        totalGlobal:        { ...totalGlobal, cumulativeTotal: totalGlobal.diff },
        parSuperviseur:     detailSups
      };
    } catch (error) {
      console.error('❌ [INTL DATE] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNATIONAL — CUMUL PLAGE (OPTIMISÉ : 2 requêtes DB au total)
  // ══════════════════════════════════════════════════════════════════════════

  async getCumulInternational(startDateStr, endDateStr) {
    if (startDateStr === endDateStr) return this.getInternationalByDate(startDateStr);

    try {
      console.log(`🌍 [CUMUL INTL] ${startDateStr} → ${endDateStr}`);
      const supervisors = await this.getSupervisors();
      const dates       = this.generateDateRange(startDateStr, endDateStr);

      const snapshotIndex = await this.loadAllSnapshots(
        supervisors.map(s => s.id), startDateStr, endDateStr
      );

      const totauxParOp = {};
      INTERNATIONAL_TYPES.forEach(t => { totauxParOp[t] = { f1: 0, f2: 0, diff: 0 }; });

      let cumulativeDiffTotal = 0;
      const parJour        = [];
      const parSuperviseur = {};

      supervisors.forEach(sup => {
        parSuperviseur[sup.id] = { id: sup.id, nom: sup.nomComplet, ops: {}, cumulativeDiff: 0 };
        INTERNATIONAL_TYPES.forEach(t => { parSuperviseur[sup.id].ops[t] = { f1: 0, f2: 0, diff: 0 }; });
      });

      for (const dateStr of dates) {
        const dayOps = {};
        INTERNATIONAL_TYPES.forEach(t => { dayOps[t] = { f1: 0, f2: 0, diff: 0 }; });
        let dayHasData = false;

        for (const sup of supervisors) {
          const entry = snapshotIndex[`${dateStr}_${sup.id}`];
          if (!entry) continue;

          const { snap, f2Data } = entry;
          const raw = this.extractInternationalFromSnapshot(snap);

          for (const type of INTERNATIONAL_TYPES) {
            const f1    = raw[type].f1;
            const f2Raw = f2Data[type];
            const f2    = f2Raw !== undefined ? this.convertFromInt(BigInt(f2Raw)) : 0;
            const diff  = f2 - f1;

            dayOps[type].f1   += f1;
            dayOps[type].f2   += f2;
            dayOps[type].diff += diff;

            totauxParOp[type].f1   += f1;
            totauxParOp[type].f2   += f2;
            totauxParOp[type].diff += diff;

            parSuperviseur[sup.id].ops[type].f1   += f1;
            parSuperviseur[sup.id].ops[type].f2   += f2;
            parSuperviseur[sup.id].ops[type].diff += diff;

            if (f1 > 0 || f2 > 0) dayHasData = true;
          }
        }

        if (dayHasData) {
          const totalJour = INTERNATIONAL_TYPES.reduce(
            (acc, t) => ({
              f1:   acc.f1   + dayOps[t].f1,
              f2:   acc.f2   + dayOps[t].f2,
              diff: acc.diff + dayOps[t].diff
            }),
            { f1: 0, f2: 0, diff: 0 }
          );

          cumulativeDiffTotal += totalJour.diff;

          parJour.push({
            date:          dateStr,
            dateDisplay:   this.formatDate(dateStr),
            ops:           { ...dayOps },
            total:         totalJour,
            cumulativeDiff: cumulativeDiffTotal
          });
        }
      }

      for (const sup of supervisors) {
        parSuperviseur[sup.id].cumulativeDiff = INTERNATIONAL_TYPES.reduce(
          (sum, t) => sum + (parSuperviseur[sup.id].ops[t].diff || 0), 0
        );
      }

      const totalGlobal = INTERNATIONAL_TYPES.reduce(
        (acc, t) => ({
          f1:   acc.f1   + totauxParOp[t].f1,
          f2:   acc.f2   + totauxParOp[t].f2,
          diff: acc.diff + totauxParOp[t].diff
        }),
        { f1: 0, f2: 0, diff: 0 }
      );

      return {
        success: true,
        mode:    'plage',
        plage: {
          debut:             startDateStr,
          fin:               endDateStr,
          nombreJours:       dates.length,
          joursAvecDonnees:  parJour.length
        },
        totauxParOperateur: totauxParOp,
        totalGlobal:        { ...totalGlobal, cumulativeTotal: cumulativeDiffTotal },
        parJour:            parJour.reverse(),
        parSuperviseur:     Object.values(parSuperviseur).sort((a, b) => {
          const totalA = INTERNATIONAL_TYPES.reduce((s, t) => s + a.ops[t].f1, 0);
          const totalB = INTERNATIONAL_TYPES.reduce((s, t) => s + b.ops[t].f1, 0);
          return totalB - totalA;
        })
      };
    } catch (error) {
      console.error('❌ [CUMUL INTL] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUMUL TOTAL DEPUIS LE DÉBUT
  // ══════════════════════════════════════════════════════════════════════════

  async getCumulTotalGeneral() {
    try {
      console.log(`📊 [CUMUL TOTAL] Calcul depuis le début`);

      const firstSnapshot = await prisma.dailySnapshot.findFirst({
        orderBy: { date: 'asc' },
        select:  { date: true }
      });

      const today = new Date().toISOString().split('T')[0];

      if (!firstSnapshot) return await this.getInternationalLive(today);

      const startDate = firstSnapshot.date.toISOString().split('T')[0];
      return await this.getCumulInternational(startDate, today);

    } catch (error) {
      console.error('❌ [CUMUL TOTAL] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUMUL TOTAL RÉEL (Snapshots + Opérations Admin)
  // ══════════════════════════════════════════════════════════════════════════

  async getRealCumulTotal() {
    try {
      console.log(`📊 [REAL CUMUL] Calcul du cumul réel (snapshots + opérations)`);

      // 1. Récupérer le cumul des snapshots
      const snapshotResult = await prisma.dailySnapshot.aggregate({
        _sum: {
          westernUnionFin: true,
          westernUnionDebut: true,
          riaFin: true,
          riaDebut: true,
          moneygramFin: true,
          moneygramDebut: true
        }
      });

      const snapshotTotal = (
        ((snapshotResult._sum.westernUnionFin || 0) - (snapshotResult._sum.westernUnionDebut || 0)) +
        ((snapshotResult._sum.riaFin || 0) - (snapshotResult._sum.riaDebut || 0)) +
        ((snapshotResult._sum.moneygramFin || 0) - (snapshotResult._sum.moneygramDebut || 0))
      ) / 100;

      // 2. Récupérer le solde des opérations admin
      const operations = await prisma.transaction.aggregate({
        where: {
          description: { startsWith: '[CUMUL_TOTAL]' },
          NOT: { description: { contains: '[SUPPRIMÉ]' } }
        },
        _sum: {
          montant: true
        },
        _count: true
      });

      // Les montants en base sont en centimes
      const operationsTotal = (operations._sum.montant || 0) / 100;

      // 3. Le cumul réel = snapshots + opérations
      const realCumulTotal = snapshotTotal + operationsTotal;

      console.log(`📊 [REAL CUMUL] Snapshots: ${snapshotTotal.toLocaleString('fr-FR')} F`);
      console.log(`📊 [REAL CUMUL] Opérations: ${operationsTotal.toLocaleString('fr-FR')} F`);
      console.log(`📊 [REAL CUMUL] TOTAL RÉEL: ${realCumulTotal.toLocaleString('fr-FR')} F`);

      return {
        success: true,
        snapshotTotal,
        operationsTotal,
        realCumulTotal,
        nombreOperations: operations._count
      };

    } catch (error) {
      console.error('❌ [REAL CUMUL] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUMUL JUSQU'À UNE DATE (Snapshots + Opérations jusqu'à cette date)
  // ══════════════════════════════════════════════════════════════════════════

  async getRealCumulUpToDate(dateStr) {
    try {
      console.log(`📊 [REAL CUMUL DATE] Calcul jusqu'au ${dateStr}`);

      const targetDate = new Date(dateStr);
      targetDate.setHours(23, 59, 59, 999);

      // 1. Snapshots jusqu'à la date
      const snapshots = await prisma.dailySnapshot.findMany({
        where: { date: { lte: targetDate } },
        select: {
          westernUnionDebut: true,
          westernUnionFin: true,
          riaDebut: true,
          riaFin: true,
          moneygramDebut: true,
          moneygramFin: true
        }
      });

      let snapshotTotal = 0;
      for (const snap of snapshots) {
        snapshotTotal += (
          (snap.westernUnionFin - snap.westernUnionDebut) +
          (snap.riaFin - snap.riaDebut) +
          (snap.moneygramFin - snap.moneygramDebut)
        );
      }
      snapshotTotal = snapshotTotal / 100;

      // 2. Opérations admin jusqu'à la date
      const operations = await prisma.transaction.aggregate({
        where: {
          description: { startsWith: '[CUMUL_TOTAL]' },
          NOT: { description: { contains: '[SUPPRIMÉ]' } },
          createdAt: { lte: targetDate }
        },
        _sum: { montant: true }
      });

      const operationsTotal = (operations._sum.montant || 0) / 100;
      const realCumulTotal = snapshotTotal + operationsTotal;

      console.log(`📊 [REAL CUMUL DATE] ${dateStr} - Snapshots: ${snapshotTotal.toLocaleString('fr-FR')} F, Opérations: ${operationsTotal.toLocaleString('fr-FR')} F, Total: ${realCumulTotal.toLocaleString('fr-FR')} F`);

      return {
        success: true,
        date: dateStr,
        snapshotTotal,
        operationsTotal,
        realCumulTotal
      };

    } catch (error) {
      console.error('❌ [REAL CUMUL DATE] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PRESETS
  // ══════════════════════════════════════════════════════════════════════════

  async getCumulInternationalByPreset(preset) {
    const { startDate, endDate } = this._presetToDates(preset, { '1m': 30, '3m': 90, '6m': 180, '1an': 365 });
    return this.getCumulInternational(startDate, endDate);
  }

  _presetToDates(preset, map) {
    const daysBack = map[preset] ?? 30;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end   = new Date(today);
    end.setDate(today.getDate() - 1);
    const start = new Date(today);
    start.setDate(today.getDate() - daysBack);
    return {
      startDate: start.toISOString().split('T')[0],
      endDate:   end.toISOString().split('T')[0]
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUMUL TOTAL — DÉPÔT ADMIN DIRECT
  // ══════════════════════════════════════════════════════════════════════════

  async createCumulDepot(adminId, montant, commentaire = null) {
    return this._createCumulOperation(adminId, 'DEPOT', montant, commentaire);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUMUL TOTAL — RETRAIT ADMIN DIRECT
  // ══════════════════════════════════════════════════════════════════════════

  async createCumulRetrait(adminId, montant, commentaire = null) {
    return this._createCumulOperation(adminId, 'RETRAIT', montant, commentaire);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Méthode interne partagée dépôt/retrait cumul total
  // ──────────────────────────────────────────────────────────────────────────

  async _createCumulOperation(adminId, type, montant, commentaire) {
    try {
      const admin = await prisma.user.findUnique({
        where:  { id: adminId },
        select: { id: true, nomComplet: true, role: true }
      });
      if (!admin) throw new Error('Utilisateur introuvable');
      if (admin.role !== 'ADMIN') throw new Error('Seul un admin peut effectuer cette opération');

      const montantFloat = parseFloat(montant);
      if (isNaN(montantFloat) || montantFloat <= 0) {
        throw new Error('Montant invalide — doit être un nombre positif');
      }

      const montantInt = this.convertToInt(montantFloat);
      const label      = type === 'DEPOT' ? 'Dépôt' : 'Retrait';

      let description = `[CUMUL_TOTAL] ${label} — ${admin.nomComplet}`;

      const commentaireTrimmed = commentaire?.trim() ?? null;
      if (commentaireTrimmed && commentaireTrimmed.length > 0) {
        description += ` | ${commentaireTrimmed}`;
      }

      const transaction = await prisma.transaction.create({
        data: {
          montant:    montantInt,
          type,
          description,
          envoyeurId: adminId,
        },
        select: {
          id: true, type: true, montant: true,
          description: true, createdAt: true
        }
      });

      console.log(`✅ [CUMUL ${type}] ${montantFloat} F — ${admin.nomComplet}`);

      return {
        success:     true,
        id:          transaction.id,
        type:        transaction.type,
        montant:     this.convertFromInt(transaction.montant),
        description: transaction.description,
        commentaire: commentaireTrimmed,
        createdAt:   transaction.createdAt,
        admin:       admin.nomComplet,
        message:     `${label} de ${montantFloat.toLocaleString('fr-FR')} F enregistré avec succès`
      };
    } catch (error) {
      console.error(`❌ [CUMUL ${type}] Erreur:`, error.message);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUMUL TOTAL — HISTORIQUE DES OPÉRATIONS
  // ══════════════════════════════════════════════════════════════════════════

  async getCumulHistory(filters = {}) {
    try {
      console.log(`📋 [CUMUL HISTORY] Chargement historique`, filters);

      const baseWhere = {
        AND: [
          { description: { startsWith: '[CUMUL_TOTAL]' } },
          { NOT: { description: { contains: '[SUPPRIMÉ]' } } }
        ]
      };

      if (filters.type && ['DEPOT', 'RETRAIT'].includes(filters.type.toUpperCase())) {
        baseWhere.AND.push({ type: filters.type.toUpperCase() });
      } else {
        baseWhere.AND.push({ type: { in: ['DEPOT', 'RETRAIT'] } });
      }

      if (filters.dateDebut || filters.dateFin) {
        const createdAtFilter = {};
        if (filters.dateDebut) {
          const d = new Date(filters.dateDebut);
          if (!isNaN(d.getTime())) {
            d.setHours(0, 0, 0, 0);
            createdAtFilter.gte = d;
          }
        }
        if (filters.dateFin) {
          const d = new Date(filters.dateFin);
          if (!isNaN(d.getTime())) {
            d.setHours(23, 59, 59, 999);
            createdAtFilter.lte = d;
          }
        }
        if (Object.keys(createdAtFilter).length > 0) {
          baseWhere.AND.push({ createdAt: createdAtFilter });
        }
      }

      const page  = Math.max(1, parseInt(filters.page  ?? 1));
      const limit = Math.min(200, Math.max(1, parseInt(filters.limit ?? 50)));
      const skip  = (page - 1) * limit;

      const [transactions, totalCount, statsAll] = await Promise.all([
        prisma.transaction.findMany({
          where: baseWhere,
          select: {
            id:          true,
            type:        true,
            montant:     true,
            description: true,
            createdAt:   true,
            envoyeur: {
              select: { id: true, nomComplet: true, role: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit
        }),
        prisma.transaction.count({ where: baseWhere }),
        (() => {
          const statsWhere = {
            AND: [
              { description: { startsWith: '[CUMUL_TOTAL]' } },
              { NOT: { description: { contains: '[SUPPRIMÉ]' } } },
              { type: { in: ['DEPOT', 'RETRAIT'] } }
            ]
          };
          if (filters.dateDebut || filters.dateFin) {
            const cf = {};
            if (filters.dateDebut) { const d = new Date(filters.dateDebut); d.setHours(0,0,0,0); cf.gte = d; }
            if (filters.dateFin)   { const d = new Date(filters.dateFin);   d.setHours(23,59,59,999); cf.lte = d; }
            if (Object.keys(cf).length) statsWhere.AND.push({ createdAt: cf });
          }
          return prisma.transaction.findMany({ where: statsWhere, select: { type: true, montant: true } });
        })()
      ]);

      let totalDepots = 0, totalRetraits = 0;
      let plusGrosDepot = 0, plusGrosRetrait = 0;

      statsAll.forEach(tx => {
        const m = this.convertFromInt(tx.montant);
        if (tx.type === 'DEPOT') {
          totalDepots += m;
          if (m > plusGrosDepot) plusGrosDepot = m;
        } else {
          totalRetraits += m;
          if (m > plusGrosRetrait) plusGrosRetrait = m;
        }
      });

      const soldeNet = totalDepots - totalRetraits;

      console.log(`📋 [CUMUL HISTORY] totalDepots=${totalDepots} totalRetraits=${totalRetraits} soldeNet=${soldeNet}`);

      const txFormatted = transactions.map(tx => {
        const m              = this.convertFromInt(tx.montant);
        const rawDescription = tx.description ?? '';

        let commentaire = null;
        const separatorIdx = rawDescription.indexOf(' | ');
        if (separatorIdx !== -1) {
          commentaire = rawDescription.slice(separatorIdx + 3).trim() || null;
        }

        return {
          id:          tx.id,
          type:        tx.type,
          montant:     m,
          createdAt:   tx.createdAt,
          description: rawDescription,
          commentaire,
          auteur: tx.envoyeur
            ? { id: tx.envoyeur.id, nomComplet: tx.envoyeur.nomComplet }
            : null
        };
      });

      return {
        success: true,
        pagination: {
          page,
          limit,
          total:       totalCount,
          totalPages:  Math.ceil(totalCount / limit),
          hasNext:     page * limit < totalCount,
          hasPrev:     page > 1
        },
        statistiques: {
          totalDepots,
          totalRetraits,
          soldeNet,
          nombreOperations: statsAll.length,
          plusGrosDepot,
          plusGrosRetrait
        },
        filtresAppliques: {
          type:      filters.type      ?? null,
          dateDebut: filters.dateDebut ?? null,
          dateFin:   filters.dateFin   ?? null
        },
        transactions: txFormatted
      };
    } catch (error) {
      console.error('❌ [CUMUL HISTORY] Erreur:', error.message);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUMUL TOTAL — SUPPRESSION LOGIQUE D'UNE OPÉRATION
  // ══════════════════════════════════════════════════════════════════════════

  async deleteCumulOperation(transactionId, adminId) {
    try {
      const transaction = await prisma.transaction.findUnique({
        where:  { id: transactionId },
        select: { id: true, type: true, montant: true, description: true, createdAt: true }
      });

      if (!transaction) throw new Error('Transaction introuvable');

      if (!transaction.description?.startsWith('[CUMUL_TOTAL]')) {
        throw new Error('Cette transaction ne fait pas partie du cumul total');
      }
      if (transaction.description?.includes('[SUPPRIMÉ]')) {
        throw new Error('Cette transaction est déjà supprimée');
      }

      const admin = await prisma.user.findUnique({
        where:  { id: adminId },
        select: { id: true, nomComplet: true, role: true }
      });
      if (!admin)             throw new Error('Utilisateur introuvable');
      if (admin.role !== 'ADMIN') throw new Error('Seul un admin peut supprimer une opération cumul total');

      const newDescription =
        `[SUPPRIMÉ] ${transaction.description} — supprimé par ${admin.nomComplet}`;

      await prisma.transaction.update({
        where: { id: transactionId },
        data:  { description: newDescription }
      });

      console.log(`✅ [CUMUL DELETE] Transaction ${transactionId} supprimée par ${admin.nomComplet}`);

      return {
        success:       true,
        transactionId,
        ancienMontant: this.convertFromInt(transaction.montant),
        type:          transaction.type,
        message:       'Opération supprimée — historique conservé pour audit'
      };
    } catch (error) {
      console.error('❌ [CUMUL DELETE] Erreur:', error.message);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CUMUL TOTAL — MODIFICATION DU MONTANT D'UNE OPÉRATION
  // ══════════════════════════════════════════════════════════════════════════

  async updateCumulOperationMontant(transactionId, newMontant, adminId) {
    try {
      const transaction = await prisma.transaction.findUnique({
        where:  { id: transactionId },
        select: { id: true, type: true, montant: true, description: true }
      });

      if (!transaction) throw new Error('Transaction introuvable');

      if (!transaction.description?.startsWith('[CUMUL_TOTAL]')) {
        throw new Error('Cette transaction ne fait pas partie du cumul total');
      }
      if (transaction.description?.includes('[SUPPRIMÉ]')) {
        throw new Error('Impossible de modifier une transaction supprimée');
      }

      const admin = await prisma.user.findUnique({
        where:  { id: adminId },
        select: { id: true, nomComplet: true, role: true }
      });
      if (!admin)             throw new Error('Utilisateur introuvable');
      if (admin.role !== 'ADMIN') throw new Error('Seul un admin peut modifier une opération cumul total');

      const newMontantFloat = parseFloat(newMontant);
      if (isNaN(newMontantFloat) || newMontantFloat <= 0) {
        throw new Error('Montant invalide — doit être un nombre positif');
      }

      const newMontantInt = this.convertToInt(newMontantFloat);
      const oldMontantInt = Number(transaction.montant);

      if (newMontantInt === oldMontantInt) {
        throw new Error('Le nouveau montant est identique à l\'ancien');
      }

      await prisma.$transaction(async (tx) => {
        await tx.transaction.update({
          where: { id: transactionId },
          data:  { montant: newMontantInt }
        });

        await tx.transaction.create({
          data: {
            montant:     newMontantInt,
            type:        'AUDIT_MODIFICATION',
            description: `[CUMUL_TOTAL][AUDIT] Modification montant tx ${transactionId} — ` +
                         `Ancien: ${this.convertFromInt(oldMontantInt)} F, ` +
                         `Nouveau: ${newMontantFloat} F — par ${admin.nomComplet}`,
            envoyeurId: adminId
          }
        });
      });

      console.log(`✅ [CUMUL UPDATE] Transaction ${transactionId} modifiée par ${admin.nomComplet}`);

      return {
        success:        true,
        transactionId,
        ancienMontant:  this.convertFromInt(oldMontantInt),
        nouveauMontant: newMontantFloat,
        message:        'Montant modifié — trace d\'audit enregistrée'
      };
    } catch (error) {
      console.error('❌ [CUMUL UPDATE] Erreur:', error.message);
      throw error;
    }
  }
}

export default new CumulService();