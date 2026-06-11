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
        f1: this.convertFromInt(snapshot.westernUnionFin   || 0),
        f2: 0, // sera rempli depuis SystemConfig
        debut: this.convertFromInt(snapshot.westernUnionDebut || 0)
      },
      RIA: {
        f1: this.convertFromInt(snapshot.riaFin   || 0),
        f2: 0,
        debut: this.convertFromInt(snapshot.riaDebut || 0)
      },
      MONEYGRAM: {
        f1: this.convertFromInt(snapshot.moneygramFin   || 0),
        f2: 0,
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

    // 1 requête pour tous les snapshots
    const snapshots = await prisma.dailySnapshot.findMany({
      where: {
        userId: { in: supervisorIds },
        date: { gte: startDate, lte: endDate }
      },
      select: {
        userId: true,
        date: true,
        westernUnionDebut: true,
        westernUnionFin: true,
        riaDebut: true,
        riaFin: true,
        moneygramDebut: true,
        moneygramFin: true,
        liquideDebut: true,
        liquideFin: true,
        orangeMoneyDebut: true,
        orangeMoneyFin: true,
        waveDebut: true,
        waveFin: true,
        uvMasterDebut: true,
        uvMasterFin: true,
        autresDebut: true,
        autresFin: true,
        freeMoneyDebut: true,
        freeMoneyFin: true,
        debutTotal: true,
        sortieTotal: true,
        grTotal: true
      }
    });

    // 1 requête pour tous les F2 (snapshot_f2_userId_date) sur la plage
    const f2Keys = [];
    for (const snap of snapshots) {
      const dateStr = snap.date.toISOString().split('T')[0];
      f2Keys.push(`snapshot_f2_${snap.userId}_${dateStr}`);
    }

    let f2Index = {};
    if (f2Keys.length > 0) {
      const f2Configs = await prisma.systemConfig.findMany({
        where: { key: { in: f2Keys } },
        select: { key: true, value: true }
      });
      f2Configs.forEach(cfg => {
        try { f2Index[cfg.key] = JSON.parse(cfg.value); } catch { f2Index[cfg.key] = {}; }
      });
    }

    // Indexer par "YYYY-MM-DD_userId"
    const index = {};
    for (const snap of snapshots) {
      const dateStr = snap.date.toISOString().split('T')[0];
      const key = `${dateStr}_${snap.userId}`;
      const f2Data = f2Index[`snapshot_f2_${snap.userId}_${dateStr}`] || {};
      index[key] = { snap, f2Data };
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

      // Charger tous les comptes en parallèle
      const allAccounts = await Promise.all(
        supervisors.map(sup =>
          prisma.account.findMany({
            where: { userId: sup.id },
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
        success: true,
        mode: 'date_unique',
        date: dateStr,
        dateDisplay: this.formatDate(dateStr) + ' (temps réel)',
        totauxParOperateur: totauxParOp,
        totalGlobal: { ...totalGlobal, cumulativeTotal: totalGlobal.diff },
        parSuperviseur: detailSups,
        isLiveData: true
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
      const targetDate = new Date(dateStr);
      targetDate.setHours(0, 0, 0, 0);

      // Charger snapshots + F2 en 2 requêtes
      const snapshotIndex = await this.loadAllSnapshots(
        supervisors.map(s => s.id), dateStr, dateStr
      );

      const totauxParOp = {};
      INTERNATIONAL_TYPES.forEach(t => { totauxParOp[t] = { f1: 0, f2: 0, diff: 0 }; });
      const detailSups = [];

      for (const sup of supervisors) {
        const entry = snapshotIndex[`${dateStr}_${sup.id}`];
        const ops = {};
        INTERNATIONAL_TYPES.forEach(t => { ops[t] = { f1: 0, f2: 0, diff: 0 }; });

        if (entry) {
          const { snap, f2Data } = entry;
          const raw = this.extractInternationalFromSnapshot(snap);

          for (const type of INTERNATIONAL_TYPES) {
            const f1 = raw[type].f1;
            // F2 depuis SystemConfig (snapshot_f2)
            const f2Raw = f2Data[type];
            const f2 = f2Raw !== undefined ? this.convertFromInt(BigInt(f2Raw)) : 0;
            const diff = f2 - f1;

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
        success: true,
        mode: 'date_unique',
        date: dateStr,
        dateDisplay: this.formatDate(dateStr),
        totauxParOperateur: totauxParOp,
        totalGlobal: { ...totalGlobal, cumulativeTotal: totalGlobal.diff },
        parSuperviseur: detailSups
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
      const dates = this.generateDateRange(startDateStr, endDateStr);

      // ✅ 2 requêtes DB pour toute la plage (snapshots + F2)
      const snapshotIndex = await this.loadAllSnapshots(
        supervisors.map(s => s.id), startDateStr, endDateStr
      );

      const totauxParOp = {};
      INTERNATIONAL_TYPES.forEach(t => { totauxParOp[t] = { f1: 0, f2: 0, diff: 0 }; });

      let cumulativeDiffTotal = 0;
      const parJour = [];
      const parSuperviseur = {};

      supervisors.forEach(sup => {
        parSuperviseur[sup.id] = {
          id: sup.id,
          nom: sup.nomComplet,
          ops: {},
          cumulativeDiff: 0
        };
        INTERNATIONAL_TYPES.forEach(t => {
          parSuperviseur[sup.id].ops[t] = { f1: 0, f2: 0, diff: 0 };
        });
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
            const f1 = raw[type].f1;
            const f2Raw = f2Data[type];
            const f2 = f2Raw !== undefined ? this.convertFromInt(BigInt(f2Raw)) : 0;
            const diff = f2 - f1;

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
            date: dateStr,
            dateDisplay: this.formatDate(dateStr),
            ops: { ...dayOps },
            total: totalJour,
            cumulativeDiff: cumulativeDiffTotal
          });
        }
      }

      // Recalculer cumulativeDiff par superviseur
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
        mode: 'plage',
        plage: {
          debut: startDateStr,
          fin: endDateStr,
          nombreJours: dates.length,
          joursAvecDonnees: parJour.length
        },
        totauxParOperateur: totauxParOp,
        totalGlobal: { ...totalGlobal, cumulativeTotal: cumulativeDiffTotal },
        parJour: parJour.reverse(),
        parSuperviseur: Object.values(parSuperviseur).sort((a, b) => {
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
        select: { date: true }
      });

      const today = new Date().toISOString().split('T')[0];

      if (!firstSnapshot) {
        return await this.getInternationalLive(today);
      }

      const startDate = firstSnapshot.date.toISOString().split('T')[0];
      return await this.getCumulInternational(startDate, today);

    } catch (error) {
      console.error('❌ [CUMUL TOTAL] Erreur:', error);
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
    const end = new Date(today);
    end.setDate(today.getDate() - 1);
    const start = new Date(today);
    start.setDate(today.getDate() - daysBack);
    return {
      startDate: start.toISOString().split('T')[0],
      endDate:   end.toISOString().split('T')[0]
    };
  }
}

export default new CumulService();