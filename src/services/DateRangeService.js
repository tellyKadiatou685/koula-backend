// src/services/DateRangeService.js
//
// Service dédié au calcul des totaux CUMULÉS d'un superviseur sur une
// PLAGE de dates (ex: du 3 au 5 juillet). Additionne les DailySnapshot
// de chaque jour de la plage, par type de compte (début + fin + F2).
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
   * Doit rester synchronisé avec TransactionService.getTypeToSnapshotField()
   * ET avec AccountLineController.SNAPSHOT_FIELD_MAP.
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
   * entre startDateStr et endDateStr (inclus), par type de compte,
   * pour début, fin, et F2 (finSecondaire, côté fin uniquement).
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
    const debut    = {};
    const sortie   = {};
    const sortieF2 = {};
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
    //
    // F2 (sortieF2) reste un cumul à part : il n'entre PAS dans
    // debutTotal/sortieTotal/grTotal (comme pour le F2 "aujourd'hui" sur
    // Account.finSecondaire, c'est une donnée parallèle, pas une variation
    // de trésorerie officielle).
    //
    // ── CORRECTION : F2 n'est PAS lu depuis les colonnes DailySnapshot
    // (snap.xxxFinSecondaire). Ces colonnes ne sont jamais remplies par le
    // reset quotidien normal (createDailySnapshot() ne les écrit pas) —
    // elles ne se remplissent que si un admin corrige F2 sur une date
    // passée via le popover. La vraie source de F2 pour une date passée
    // est la clé systemConfig `snapshot_f2_${userId}_${dateStr}`, exactement
    // comme dans TransactionService.getSnapshotForDate(). On lit donc F2
    // depuis là, jour par jour, pour rester cohérent avec la vue "jour
    // unique" du dashboard.
    for (const snap of snapshots) {
      for (const [type, [debutField, finField]] of Object.entries(fieldMap)) {
        add(debut,  type, this.convertFromInt(snap[debutField]));
        add(sortie, type, this.convertFromInt(snap[finField]));
      }

      const dateStr = snap.date.toISOString().split('T')[0];

      // ── F2 : lecture depuis systemConfig (source de vérité du reset) ──
      const f2Key = `snapshot_f2_${supervisorId}_${dateStr}`;
      const f2Config = await prisma.systemConfig.findFirst({ where: { key: f2Key } });
      const f2Data = f2Config?.value ? JSON.parse(f2Config.value) : {};

      for (const type of Object.keys(fieldMap)) {
        const f2Raw = f2Data[type];
        if (f2Raw !== undefined && f2Raw !== null) {
          try {
            add(sortieF2, type, this.convertFromInt(BigInt(f2Raw)));
          } catch (_) { /* ignore valeur invalide */ }
        }
      }

      // Slots custom AUTRES_* sauvegardés en dehors des champs fixes
      const extraKey = `snapshot_extra_${supervisorId}_${dateStr}`;
      const extraConfig = await prisma.systemConfig.findFirst({ where: { key: extraKey } });
      if (extraConfig?.value) {
        try {
          const extraTypes = JSON.parse(extraConfig.value);
          for (const [type, values] of Object.entries(extraTypes)) {
            if (fieldMap[type]) continue; // déjà traité ci-dessus
            add(debut,  type, this.convertFromInt(BigInt(values.debut || 0)));
            add(sortie, type, this.convertFromInt(BigInt(values.fin   || 0)));

            // F2 pour les types custom : priorité systemConfig, sinon
            // valeur embarquée dans snapshot_extra (même logique que
            // TransactionService.getSnapshotForDate)
            const f2FromConfig = f2Data[type];
            if (f2FromConfig !== undefined && f2FromConfig !== null) {
              try {
                add(sortieF2, type, this.convertFromInt(BigInt(f2FromConfig)));
              } catch (_) { /* ignore */ }
            } else if (values.finSecondaire) {
              try {
                add(sortieF2, type, this.convertFromInt(BigInt(values.finSecondaire)));
              } catch (_) { /* ignore */ }
            }
          }
        } catch (_) { /* ignore JSON invalide */ }
      }
    }

    // ── Partenaires : transactions archivées dans la plage, cumulées par nom ──
    // Note : les partenaires n'ont pas de F2 (concept propre aux comptes fixes).
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
    const debutTotal    = Object.values(debut).reduce((sum, v) => sum + v, 0);
    const sortieTotal   = Object.values(sortie).reduce((sum, v) => sum + v, 0);
    const sortieF2Total = Object.values(sortieF2).reduce((sum, v) => sum + v, 0);
    const grTotal       = sortieTotal - debutTotal;

    return {
      superviseur: { id: supervisor.id, nom: supervisor.nomComplet, status: supervisor.status },
      startDate: start.toISOString().split('T')[0],
      endDate:   end.toISOString().split('T')[0],
      daysFound: snapshots.length,
      missingDays: this._findMissingDays(start, end, snapshots),
      comptes: { debut, sortie, sortieF2 },
      partenaires,
      totaux: {
        debutTotal, sortieTotal, sortieF2Total, grTotal,
        formatted: {
          debutTotal:    this.formatAmount(debutTotal),
          sortieTotal:   this.formatAmount(sortieTotal),
          sortieF2Total: this.formatAmount(sortieF2Total),
          grTotal:       this.formatAmount(grTotal, true)
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