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

  /** Active supervisors (shared across méthodes) */
  async getSupervisors() {
    return prisma.user.findMany({
      where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
      select: { id: true, nomComplet: true }
    });
  }

  /** Formate une date YYYY-MM-DD pour l'affichage */
  formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      weekday: 'short', day: '2-digit', month: 'short'
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // F1 / F2 — SNAPSHOT D'UNE DATE UNIQUE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Retourne les F1/F2 pour une seule journée, tous superviseurs confondus.
   * @param {string} dateStr  YYYY-MM-DD
   */
  async getF1F2ByDate(dateStr) {
    try {
      console.log(`📊 [F1F2 DATE] ${dateStr}`);
      const supervisors = await this.getSupervisors();
      const targetDate  = new Date(dateStr);
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
        const sortie   = snapshot.comptes?.sortie   || {};
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

  /**
   * Cumul F1/F2 sur une plage startDateStr → endDateStr.
   * Si startDateStr === endDateStr, délègue à getF1F2ByDate (optimisation).
   * @param {string} startDateStr  YYYY-MM-DD
   * @param {string} endDateStr    YYYY-MM-DD
   */
  async getCumulF1F2(startDateStr, endDateStr) {
    // Cas date unique
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
          const sortie   = snapshot.comptes?.sortie   || {};
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

          parSuperviseur[sup.id].cumulF1   += supF1;
          parSuperviseur[sup.id].cumulF2   += supF2;
          parSuperviseur[sup.id].cumulDiff += supDiff;
          if (supF1 > 0 || supF2 > 0) parSuperviseur[sup.id].jours++;
        }

        const dayDiff = dayF2 - dayF1;
        grandF1   += dayF1;
        grandF2   += dayF2;
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

  /**
   * Retourne WU / RIA / MoneyGram pour une seule journée.
   * @param {string} dateStr  YYYY-MM-DD
   */
  async getInternationalByDate(dateStr) {
    try {
      console.log(`🌍 [INTL DATE] ${dateStr}`);
      const supervisors = await this.getSupervisors();
      const targetDate  = new Date(dateStr);
      targetDate.setHours(0, 0, 0, 0);

      const totauxParOp = {};
      INTERNATIONAL_TYPES.forEach(t => { totauxParOp[t] = { debut: 0, fin: 0, gr: 0 }; });

      const detailSups = [];

      for (const sup of supervisors) {
        const snapshot = await TransactionService.getSnapshotForDate(sup.id, targetDate);
        const ops = {};
        INTERNATIONAL_TYPES.forEach(t => { ops[t] = { debut: 0, fin: 0, gr: 0 }; });

        if (snapshot) {
          const debut  = snapshot.comptes?.debut  || {};
          const sortie = snapshot.comptes?.sortie || {};

          for (const type of INTERNATIONAL_TYPES) {
            const d = debut[type]  || 0;
            const f = sortie[type] || 0;
            const g = d - f;
            ops[type] = { debut: d, fin: f, gr: g };
            totauxParOp[type].debut += d;
            totauxParOp[type].fin   += f;
            totauxParOp[type].gr    += g;
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

  /**
   * Cumul WU / RIA / MoneyGram sur une plage.
   * Si startDateStr === endDateStr, délègue à getInternationalByDate.
   */
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

          const debut  = snapshot.comptes?.debut  || {};
          const sortie = snapshot.comptes?.sortie || {};

          for (const type of INTERNATIONAL_TYPES) {
            const d = debut[type]  || 0;
            const f = sortie[type] || 0;
            const g = d - f;

            dayOps[type].debut += d;
            dayOps[type].fin   += f;
            dayOps[type].gr    += g;

            totauxParOp[type].debut += d;
            totauxParOp[type].fin   += f;
            totauxParOp[type].gr    += g;

            parSuperviseur[sup.id].ops[type].debut += d;
            parSuperviseur[sup.id].ops[type].fin   += f;
            parSuperviseur[sup.id].ops[type].gr    += g;

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

  /** Presets F1F2 : '2j' | '3j' | '1m' | '1an' */
  async getCumulF1F2ByPreset(preset) {
    const { startDate, endDate } = this._presetToDates(preset, { '2j':2,'3j':3,'1m':30,'1an':365 });
    return this.getCumulF1F2(startDate, endDate);
  }

  /** Presets international : '1m' | '3m' | '6m' | '1an' */
  async getCumulInternationalByPreset(preset) {
    const { startDate, endDate } = this._presetToDates(preset, { '1m':30,'3m':90,'6m':180,'1an':365 });
    return this.getCumulInternational(startDate, endDate);
  }

  _presetToDates(preset, map) {
    const daysBack = map[preset] ?? 30;
    const today = new Date(); today.setHours(0,0,0,0);
    const end   = new Date(today); end.setDate(today.getDate() - 1);
    const start = new Date(today); start.setDate(today.getDate() - daysBack);
    return {
      startDate: start.toISOString().split('T')[0],
      endDate:   end.toISOString().split('T')[0]
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ENDPOINT COMBINÉ
  // ══════════════════════════════════════════════════════════════════════════

  /** F1F2 + International en un seul appel.
   *  Si une seule date → passe la même date en start ET end. */
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