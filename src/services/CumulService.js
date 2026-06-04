// src/services/CumulService.js
import prisma from '../config/database.js';
import TransactionService from './TransactionService.js';

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
  fmt(n) { return Math.abs(n).toLocaleString('fr-FR') + '\u202FF'; }

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

  // ══════════════════════════════════════════════════════════════════════════
  // DONNÉES EN TEMPS RÉEL (POUR LA DATE DU JOUR)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Récupère les F1/F2 en temps réel depuis les comptes actuels
   */
  async getF1F2Live(dateStr) {
    try {
      console.log(`📊 [F1F2 LIVE] Données temps réel pour ${dateStr}`);
      
      const supervisors = await this.getSupervisors();
      let totalF1 = 0, totalF2 = 0;
      const detailSups = [];

      for (const sup of supervisors) {
        const accounts = await prisma.account.findMany({
          where: { userId: sup.id },
          select: { type: true, balance: true, finSecondaire: true }
        });

        let supF1 = 0, supF2 = 0;
        
        for (const account of accounts) {
          const f1 = this.convertFromInt(account.balance || 0);
          const f2 = this.convertFromInt(account.finSecondaire || 0);
          
          // Ignorer les comptes partenaires
          if (!account.type.startsWith('part-') && !account.type.startsWith('sup-')) {
            supF1 += f1;
            supF2 += f2;
          }
        }
        
        totalF1 += supF1;
        totalF2 += supF2;
        
        detailSups.push({
          id: sup.id,
          nom: sup.nomComplet,
          f1: supF1,
          f2: supF2,
          diff: supF2 - supF1,
          hasData: (supF1 > 0 || supF2 > 0)
        });
      }

      return {
        success: true,
        mode: 'date_unique',
        date: dateStr,
        dateDisplay: this.formatDate(dateStr) + ' (temps réel)',
        totaux: { f1: totalF1, f2: totalF2, diff: totalF2 - totalF1 },
        parSuperviseur: detailSups.sort((a, b) => b.diff - a.diff),
        isLiveData: true
      };

    } catch (error) {
      console.error('❌ [F1F2 LIVE] Erreur:', error);
      throw error;
    }
  }

  /**
   * Récupère les transferts internationaux en temps réel
   */
  async getInternationalLive(dateStr) {
    try {
      console.log(`🌍 [INTL LIVE] Données temps réel pour ${dateStr}`);
      
      const supervisors = await this.getSupervisors();
      
      const totauxParOp = {
        WESTERN_UNION: { debut: 0, fin: 0, gr: 0 },
        RIA: { debut: 0, fin: 0, gr: 0 },
        MONEYGRAM: { debut: 0, fin: 0, gr: 0 }
      };
      
      const detailSups = [];

      for (const sup of supervisors) {
        const accounts = await prisma.account.findMany({
          where: { userId: sup.id },
          select: { type: true, balance: true, initialBalance: true }
        });
        
        const ops = {
          WESTERN_UNION: { debut: 0, fin: 0, gr: 0 },
          RIA: { debut: 0, fin: 0, gr: 0 },
          MONEYGRAM: { debut: 0, fin: 0, gr: 0 }
        };
        
        for (const account of accounts) {
          const type = account.type;
          if (totauxParOp[type]) {
            const debut = this.convertFromInt(account.initialBalance || 0);
            const fin = this.convertFromInt(account.balance || 0);
            const gr = debut - fin;
            
            ops[type].debut += debut;
            ops[type].fin += fin;
            ops[type].gr += gr;
            
            totauxParOp[type].debut += debut;
            totauxParOp[type].fin += fin;
            totauxParOp[type].gr += gr;
          }
        }
        
        const aDesDonnees = Object.values(ops).some(o => o.debut > 0 || o.fin > 0);
        if (aDesDonnees) {
          detailSups.push({
            id: sup.id,
            nom: sup.nomComplet,
            ops,
            hasData: true
          });
        }
      }
      
      const totalGlobal = {
        debut: totauxParOp.WESTERN_UNION.debut + totauxParOp.RIA.debut + totauxParOp.MONEYGRAM.debut,
        fin: totauxParOp.WESTERN_UNION.fin + totauxParOp.RIA.fin + totauxParOp.MONEYGRAM.fin,
        gr: totauxParOp.WESTERN_UNION.gr + totauxParOp.RIA.gr + totauxParOp.MONEYGRAM.gr
      };

      return {
        success: true,
        mode: 'date_unique',
        date: dateStr,
        dateDisplay: this.formatDate(dateStr) + ' (temps réel)',
        totauxParOperateur: totauxParOp,
        totalGlobal,
        parSuperviseur: detailSups,
        isLiveData: true
      };

    } catch (error) {
      console.error('❌ [INTL LIVE] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // F1 / F2 — SNAPSHOT D'UNE DATE UNIQUE
  // ══════════════════════════════════════════════════════════════════════════

  async getF1F2ByDate(dateStr) {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Si c'est la date du jour → données temps réel
      if (dateStr === today) {
        return await this.getF1F2Live(dateStr);
      }
      
      // Sinon → snapshot historique
      console.log(`📊 [F1F2 SNAPSHOT] ${dateStr}`);
      const supervisors = await this.getSupervisors();
      const targetDate = new Date(dateStr);
      targetDate.setHours(0, 0, 0, 0);

      let totalF1 = 0, totalF2 = 0;
      const detailSups = [];

      for (const sup of supervisors) {
        const snapshot = await TransactionService.getSnapshotForDate(sup.id, targetDate);

        if (!snapshot) {
          detailSups.push({ id: sup.id, nom: sup.nomComplet, f1: 0, f2: 0, diff: 0, hasData: false });
          continue;
        }

        let supF1 = 0, supF2 = 0;
        const sortie = snapshot.comptes?.sortie || {};
        const sortieF2 = snapshot.comptes?.sortieF2 || {};

        for (const [type, val] of Object.entries(sortie)) {
          if (!type.startsWith('part-')) supF1 += (val || 0);
        }
        for (const [type, val] of Object.entries(sortieF2)) {
          if (!type.startsWith('part-')) supF2 += (val || 0);
        }

        totalF1 += supF1;
        totalF2 += supF2;
        detailSups.push({
          id: sup.id, nom: sup.nomComplet,
          f1: supF1, f2: supF2, diff: supF2 - supF1,
          hasData: true
        });
      }

      return {
        success: true,
        mode: 'date_unique',
        date: dateStr,
        dateDisplay: this.formatDate(dateStr),
        totaux: { f1: totalF1, f2: totalF2, diff: totalF2 - totalF1 },
        parSuperviseur: detailSups.sort((a, b) => b.diff - a.diff)
      };

    } catch (error) {
      console.error('❌ [F1F2 DATE] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // F1 / F2 — CUMUL SUR UNE PLAGE DE DATES
  // ══════════════════════════════════════════════════════════════════════════

  async getCumulF1F2(startDateStr, endDateStr) {
    if (startDateStr === endDateStr) return this.getF1F2ByDate(startDateStr);

    try {
      console.log(`📊 [CUMUL F1F2] ${startDateStr} → ${endDateStr}`);
      const supervisors = await this.getSupervisors();
      const dates = this.generateDateRange(startDateStr, endDateStr);

      let grandF1 = 0, grandF2 = 0, grandDiff = 0;
      const parJour = [];
      const parSuperviseur = {};

      supervisors.forEach(sup => {
        parSuperviseur[sup.id] = {
          id: sup.id, nom: sup.nomComplet,
          cumulF1: 0, cumulF2: 0, cumulDiff: 0, jours: 0
        };
      });

      for (const dateStr of dates) {
        const targetDate = new Date(dateStr);
        targetDate.setHours(0, 0, 0, 0);

        let dayF1 = 0, dayF2 = 0;
        const detailSups = [];

        for (const sup of supervisors) {
          const snapshot = await TransactionService.getSnapshotForDate(sup.id, targetDate);

          if (!snapshot) {
            detailSups.push({ id: sup.id, nom: sup.nomComplet, f1: 0, f2: 0, diff: 0, hasData: false });
            continue;
          }

          let supF1 = 0, supF2 = 0;
          const sortie = snapshot.comptes?.sortie || {};
          const sortieF2 = snapshot.comptes?.sortieF2 || {};

          for (const [type, val] of Object.entries(sortie)) {
            if (!type.startsWith('part-')) supF1 += (val || 0);
          }
          for (const [type, val] of Object.entries(sortieF2)) {
            if (!type.startsWith('part-')) supF2 += (val || 0);
          }

          const supDiff = supF2 - supF1;
          dayF1 += supF1;
          dayF2 += supF2;
          detailSups.push({ id: sup.id, nom: sup.nomComplet, f1: supF1, f2: supF2, diff: supDiff, hasData: true });

          parSuperviseur[sup.id].cumulF1 += supF1;
          parSuperviseur[sup.id].cumulF2 += supF2;
          parSuperviseur[sup.id].cumulDiff += supDiff;
          if (supF1 > 0 || supF2 > 0) parSuperviseur[sup.id].jours++;
        }

        const dayDiff = dayF2 - dayF1;
        grandF1 += dayF1;
        grandF2 += dayF2;
        grandDiff += dayDiff;

        parJour.push({
          date: dateStr,
          dateDisplay: this.formatDate(dateStr),
          f1: dayF1, f2: dayF2, diff: dayDiff,
          superviseurs: detailSups
        });
      }

      return {
        success: true,
        mode: 'plage',
        plage: { debut: startDateStr, fin: endDateStr, nombreJours: dates.length },
        totaux: { cumulF1: grandF1, cumulF2: grandF2, cumulDiff: grandDiff },
        parJour,
        parSuperviseur: Object.values(parSuperviseur).sort((a, b) => b.cumulDiff - a.cumulDiff)
      };

    } catch (error) {
      console.error('❌ [CUMUL F1F2] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNATIONAL — SNAPSHOT D'UNE DATE UNIQUE
  // ══════════════════════════════════════════════════════════════════════════

  async getInternationalByDate(dateStr) {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      // Si c'est la date du jour → données temps réel
      if (dateStr === today) {
        return await this.getInternationalLive(dateStr);
      }
      
      // Sinon → snapshot historique
      console.log(`🌍 [INTL SNAPSHOT] ${dateStr}`);
      const supervisors = await this.getSupervisors();
      const targetDate = new Date(dateStr);
      targetDate.setHours(0, 0, 0, 0);

      const totauxParOp = {};
      INTERNATIONAL_TYPES.forEach(t => { totauxParOp[t] = { debut: 0, fin: 0, gr: 0 }; });

      const detailSups = [];

      for (const sup of supervisors) {
        const snapshot = await TransactionService.getSnapshotForDate(sup.id, targetDate);
        const ops = {};
        INTERNATIONAL_TYPES.forEach(t => { ops[t] = { debut: 0, fin: 0, gr: 0 }; });

        if (snapshot) {
          const debut = snapshot.comptes?.debut || {};
          const sortie = snapshot.comptes?.sortie || {};

          for (const type of INTERNATIONAL_TYPES) {
            const d = debut[type] || 0;
            const f = sortie[type] || 0;
            const g = d - f;
            ops[type] = { debut: d, fin: f, gr: g };
            totauxParOp[type].debut += d;
            totauxParOp[type].fin += f;
            totauxParOp[type].gr += g;
          }
        }

        detailSups.push({ id: sup.id, nom: sup.nomComplet, ops, hasData: !!snapshot });
      }

      const totalGlobal = INTERNATIONAL_TYPES.reduce(
        (acc, t) => ({ debut: acc.debut + totauxParOp[t].debut, fin: acc.fin + totauxParOp[t].fin, gr: acc.gr + totauxParOp[t].gr }),
        { debut: 0, fin: 0, gr: 0 }
      );

      return {
        success: true,
        mode: 'date_unique',
        date: dateStr,
        dateDisplay: this.formatDate(dateStr),
        totauxParOperateur: totauxParOp,
        totalGlobal,
        parSuperviseur: detailSups
      };

    } catch (error) {
      console.error('❌ [INTL DATE] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNATIONAL — CUMUL SUR UNE PLAGE DE DATES
  // ══════════════════════════════════════════════════════════════════════════

  async getCumulInternational(startDateStr, endDateStr) {
    if (startDateStr === endDateStr) return this.getInternationalByDate(startDateStr);

    try {
      console.log(`🌍 [CUMUL INTL] ${startDateStr} → ${endDateStr}`);
      const supervisors = await this.getSupervisors();
      const dates = this.generateDateRange(startDateStr, endDateStr);

      const totauxParOp = {};
      INTERNATIONAL_TYPES.forEach(t => { totauxParOp[t] = { debut: 0, fin: 0, gr: 0 }; });

      const parJour = [];
      const parSuperviseur = {};
      supervisors.forEach(sup => {
        parSuperviseur[sup.id] = { id: sup.id, nom: sup.nomComplet, ops: {} };
        INTERNATIONAL_TYPES.forEach(t => { parSuperviseur[sup.id].ops[t] = { debut: 0, fin: 0, gr: 0 }; });
      });

      for (const dateStr of dates) {
        const targetDate = new Date(dateStr);
        targetDate.setHours(0, 0, 0, 0);

        const dayOps = {};
        INTERNATIONAL_TYPES.forEach(t => { dayOps[t] = { debut: 0, fin: 0, gr: 0 }; });
        let dayHasData = false;

        for (const sup of supervisors) {
          const snapshot = await TransactionService.getSnapshotForDate(sup.id, targetDate);
          if (!snapshot) continue;

          const debut = snapshot.comptes?.debut || {};
          const sortie = snapshot.comptes?.sortie || {};

          for (const type of INTERNATIONAL_TYPES) {
            const d = debut[type] || 0;
            const f = sortie[type] || 0;
            const g = d - f;

            dayOps[type].debut += d;
            dayOps[type].fin += f;
            dayOps[type].gr += g;

            totauxParOp[type].debut += d;
            totauxParOp[type].fin += f;
            totauxParOp[type].gr += g;

            parSuperviseur[sup.id].ops[type].debut += d;
            parSuperviseur[sup.id].ops[type].fin += f;
            parSuperviseur[sup.id].ops[type].gr += g;

            if (d > 0 || f > 0) dayHasData = true;
          }
        }

        if (dayHasData) {
          const totalJour = INTERNATIONAL_TYPES.reduce(
            (acc, t) => ({ debut: acc.debut + dayOps[t].debut, fin: acc.fin + dayOps[t].fin, gr: acc.gr + dayOps[t].gr }),
            { debut: 0, fin: 0, gr: 0 }
          );
          parJour.push({
            date: dateStr,
            dateDisplay: this.formatDate(dateStr),
            ops: { ...dayOps },
            total: totalJour
          });
        }
      }

      const totalGlobal = INTERNATIONAL_TYPES.reduce(
        (acc, t) => ({ debut: acc.debut + totauxParOp[t].debut, fin: acc.fin + totauxParOp[t].fin, gr: acc.gr + totauxParOp[t].gr }),
        { debut: 0, fin: 0, gr: 0 }
      );

      return {
        success: true,
        mode: 'plage',
        plage: { debut: startDateStr, fin: endDateStr, nombreJours: dates.length, joursAvecDonnees: parJour.length },
        totauxParOperateur: totauxParOp,
        totalGlobal,
        parJour: parJour.reverse(),
        parSuperviseur: Object.values(parSuperviseur)
          .sort((a, b) => {
            const totalA = INTERNATIONAL_TYPES.reduce((s, t) => s + a.ops[t].debut, 0);
            const totalB = INTERNATIONAL_TYPES.reduce((s, t) => s + b.ops[t].debut, 0);
            return totalB - totalA;
          })
      };

    } catch (error) {
      console.error('❌ [CUMUL INTL] Erreur:', error);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PRESETS
  // ══════════════════════════════════════════════════════════════════════════

  async getCumulF1F2ByPreset(preset) {
    const { startDate, endDate } = this._presetToDates(preset, { '2j':2,'3j':3,'1m':30,'1an':365 });
    return this.getCumulF1F2(startDate, endDate);
  }

  async getCumulInternationalByPreset(preset) {
    const { startDate, endDate } = this._presetToDates(preset, { '1m':30,'3m':90,'6m':180,'1an':365 });
    return this.getCumulInternational(startDate, endDate);
  }

  _presetToDates(preset, map) {
    const daysBack = map[preset] ?? 30;
    const today = new Date(); today.setHours(0,0,0,0);
    const end = new Date(today); end.setDate(today.getDate() - 1);
    const start = new Date(today); start.setDate(today.getDate() - daysBack);
    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0]
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ENDPOINT COMBINÉ
  // ══════════════════════════════════════════════════════════════════════════

  async getFullCumul(startDateStr, endDateStr) {
    const end = endDateStr ?? startDateStr;
    const [f1f2, intl] = await Promise.all([
      this.getCumulF1F2(startDateStr, end),
      this.getCumulInternational(startDateStr, end)
    ]);
    return { f1f2, international: intl };
  }
}

export default new CumulService();