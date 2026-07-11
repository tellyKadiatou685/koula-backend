// src/services/DateRangeService.js
//
// Service dédié au calcul des totaux CUMULÉS d'un superviseur sur une
// PLAGE de dates (ex: du 3 au 5 juillet). Additionne les DailySnapshot
// de chaque jour de la plage, par type de compte (début + fin).
//
// Fichier isolé : ne modifie ni ne dépend de TransactionService.js.

import prisma from '../config/database.js';

class DateRangeService {

  convertFromInt(v) {
    return Number(v) / 100;
  }

  formatAmount(amount, withSign = false) {
    const num = typeof amount === 'number' ? amount : parseFloat(amount);
    if (withSign) return num > 0 ? `+${num.toLocaleString('fr-FR')} F` : `${num.toLocaleString('fr-FR')} F`;
    return `${Math.abs(num).toLocaleString('fr-FR')} F`;
  }

  /**
   * Mapping type de compte → champs du DailySnapshot.
   * Doit rester synchronisé avec TransactionService.getTypeToSnapshotField().
   */
  getTypeToSnapshotField() {
    return {
      LIQUIDE:       ['liquideDebut',       'liquideFin'       ],
      ORANGE_MONEY:  ['orangeMoneyDebut',   'orangeMoneyFin'   ],
      WAVE:          ['waveDebut',          'waveFin'          ],
      UV_MASTER:     ['uvMasterDebut',      'uvMasterFin'      ],
      AUTRES:        ['autresDebut',        'autresFin'        ],
      FREE_MONEY:    ['freeMoneyDebut',     'freeMoneyFin'     ],
      WESTERN_UNION: ['westernUnionDebut',  'westernUnionFin'  ],
      RIA:           ['riaDebut',           'riaFin'           ],
      MONEYGRAM:     ['moneygramDebut',     'moneygramFin'     ],
      WESTERN_2:     ['westernUnion2Debut', 'westernUnion2Fin' ],
      RIA_2:         ['ria2Debut',          'ria2Fin'          ],
    };
  }

  /**
   * Valide et normalise deux dates : accepte les deux ordres
   * (ex: "5 puis 3" ou "3 puis 5" donnent le même résultat).
   */
  validateRange(startDateStr, endDateStr) {
    const a = new Date(startDateStr);
    const b = new Date(endDateStr);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) {
      throw new Error('Dates invalides (format attendu: YYYY-MM-DD)');
    }
    a.setHours(0, 0, 0, 0);
    b.setHours(0, 0, 0, 0);

    const start = a <= b ? a : b;
    const end   = a <= b ? b : a;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (start > today) throw new Error('La date de début ne peut pas être dans le futur');

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    if (start < oneYearAgo) throw new Error('Date trop ancienne (limite: 1 an)');

    return { start, end };
  }

  /**
   * Additionne, pour un superviseur, tous les DailySnapshot compris
   * entre startDateStr et endDateStr (inclus), par type de compte.
   */
  async getSupervisorRangeTotals(supervisorId, startDateStr, endDateStr) {
    const supervisor = await prisma.user.findFirst({
        where: { id: supervisorId, role: 'SUPERVISEUR' },
        select: { id: true, nomComplet: true, status: true }
      });
    if (!supervisor) throw new Error('Superviseur non trouvé');

    const { start, end } = this.validateRange(startDateStr, endDateStr);

    const snapshots = await prisma.dailySnapshot.findMany({
      where: { userId: supervisorId, date: { gte: start, lte: end } },
      orderBy: { date: 'asc' }
    });

    const fieldMap = this.getTypeToSnapshotField();
    const debut  = {};
    const sortie = {};
    const add = (bucket, type, val) => {
      if (!val) return;
      bucket[type] = (bucket[type] || 0) + val;
    };

    // ── IMPORTANT : on n'accumule plus debutTotal/sortieTotal depuis
    // snap.debutTotal / snap.sortieTotal. Ces deux champs stockés dans le
    // DailySnapshot n'ont pas une sémantique garantie uniforme : selon la
    // fonction qui a créé ou mis à jour le snapshot en dernier, ils peuvent
    // ou non déjà inclure les montants partenaires. Pour ne pas risquer un
    // double comptage (partenaires comptés une fois dans le champ stocké,
    // une seconde fois via la requête Transaction ci-dessous), on calcule
    // debutTotal/sortieTotal une seule fois à la fin, en sommant les objets
    // `debut`/`sortie` qu'on construit nous-mêmes ici (comptes + slots
    // extra + partenaires, chacun ajouté une seule fois via `add`).
    for (const snap of snapshots) {
      for (const [type, [debutField, finField]] of Object.entries(fieldMap)) {
        add(debut,  type, this.convertFromInt(snap[debutField]));
        add(sortie, type, this.convertFromInt(snap[finField]));
      }

      // Slots custom AUTRES_* sauvegardés en dehors des champs fixes
      const dateStr  = snap.date.toISOString().split('T')[0];
      const extraKey = `snapshot_extra_${supervisorId}_${dateStr}`;
      const extraConfig = await prisma.systemConfig.findFirst({ where: { key: extraKey } });
      if (extraConfig?.value) {
        try {
          const extraTypes = JSON.parse(extraConfig.value);
          for (const [type, values] of Object.entries(extraTypes)) {
            if (fieldMap[type]) continue; // déjà traité ci-dessus
            add(debut,  type, this.convertFromInt(BigInt(values.debut || 0)));
            add(sortie, type, this.convertFromInt(BigInt(values.fin   || 0)));
          }
        } catch (_) { /* ignore JSON invalide */ }
      }
    }

    // ── Partenaires : transactions archivées dans la plage, cumulées par nom ──
    const dayEnd = new Date(end);
    dayEnd.setHours(23, 59, 59, 999);

    const partnerTx = await prisma.transaction.findMany({
      where: {
        destinataireId: supervisorId,
        type: { in: ['DEPOT', 'RETRAIT'] },
        archived: true,
        createdAt: { gte: start, lte: dayEnd },
        NOT: { description: { startsWith: '[SUPPRIMÉ]' } }
      },
      select: {
        type: true, montant: true,
        partenaireId: true, partenaireNom: true,
        partenaire: { select: { nomComplet: true } }
      }
    });

    const partenaires = {};
    for (const tx of partnerTx) {
      const name = tx.partenaire?.nomComplet || tx.partenaireNom || 'Partenaire inconnu';
      if (!partenaires[name]) partenaires[name] = { depots: 0, retraits: 0 };
      const montant = this.convertFromInt(tx.montant);

      if (tx.type === 'DEPOT') {
        partenaires[name].depots += montant;
        add(debut, `part-${name}`, montant);
      } else {
        partenaires[name].retraits += montant;
        add(sortie, `part-${name}`, montant);
      }
    }

    // ── Calcul final unique des totaux, à partir des objets déjà agrégés ──
    const debutTotal  = Object.values(debut).reduce((sum, v) => sum + v, 0);
    const sortieTotal = Object.values(sortie).reduce((sum, v) => sum + v, 0);
    const grTotal      = sortieTotal - debutTotal;

    return {
      superviseur: { id: supervisor.id, nom: supervisor.nomComplet, status: supervisor.status },
      startDate: start.toISOString().split('T')[0],
      endDate:   end.toISOString().split('T')[0],
      daysFound: snapshots.length,
      missingDays: this._findMissingDays(start, end, snapshots),
      comptes: { debut, sortie },
      partenaires,
      totaux: {
        debutTotal, sortieTotal, grTotal,
        formatted: {
          debutTotal:  this.formatAmount(debutTotal),
          sortieTotal: this.formatAmount(sortieTotal),
          grTotal:     this.formatAmount(grTotal, true)
        }
      }
    };
  }

  /**
   * Liste les jours de la plage pour lesquels aucun snapshot n'existe
   * (utile pour prévenir l'utilisateur que le total est peut-être incomplet).
   * "Aujourd'hui" est ignoré : son snapshot n'est créé qu'au reset du soir.
   */
  _findMissingDays(start, end, snapshots) {
    const found = new Set(snapshots.map(s => s.date.toISOString().split('T')[0]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const missing = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const dStr = cursor.toISOString().split('T')[0];
      if (!found.has(dStr) && cursor.getTime() !== today.getTime()) {
        missing.push(dStr);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return missing;
  }
}

export default new DateRangeService();