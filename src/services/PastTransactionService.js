// src/services/PastTransactionService.js
//
// Service dédié à la création de transactions sur une date PASSÉE
// (hier, ou une date personnalisée choisie via le filtre du dashboard).
//
// Pourquoi un fichier séparé de TransactionService.js ?
// -------------------------------------------------------------
// Pour "aujourd'hui", les montants vivent dans la table Account (solde en direct).
// Pour une date passée, Account a déjà été remis à zéro par le reset quotidien :
// les données de cette journée-là vivent uniquement dans DailySnapshot
// (+ la clé SystemConfig "snapshot_f2_..." pour le F2).
//
// Ce service écrit donc dans DailySnapshot / SystemConfig, JAMAIS dans Account,
// pour ne pas fausser le solde en direct du jour actuel.
//
// Il ne modifie ni ne dépend de TransactionService.js : c'est un chemin de code
// 100% additif et isolé.

import prisma from '../config/database.js';
import NotificationService from './NotificationService.js';

const RESET_HOUR = 0;
const RESET_MINUTE = 50;

class PastTransactionService {

  // ── Helpers génériques ──────────────────────────────────────────────────

  convertToInt(value) {
    if (typeof value === 'number') return Math.round(value * 100);
    if (typeof value === 'string') return Math.round(parseFloat(value) * 100);
    return Math.round(value * 100);
  }

  convertFromInt(value) {
    return Number(value) / 100;
  }

  formatAmount(amount, withSign = false) {
    const num = typeof amount === 'number' ? amount : parseFloat(amount);
    if (withSign) return num > 0 ? `+${num.toLocaleString('fr-FR')} F` : `${num.toLocaleString('fr-FR')} F`;
    return `${Math.abs(num).toLocaleString('fr-FR')} F`;
  }

  /**
   * true si targetDate est strictement avant aujourd'hui (jour calendaire).
   */
  isPastDate(targetDate) {
    if (!targetDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(targetDate);
    if (isNaN(target.getTime())) throw new Error('Date invalide');
    target.setHours(0, 0, 0, 0);
    return target < today;
  }

  /**
   * Valide qu'une date est bien formée, pas dans le futur, pas trop ancienne.
   */
  validateTargetDate(targetDate) {
    if (!targetDate) return { valid: false, error: 'Date requise' };
    const date = new Date(targetDate);
    if (isNaN(date.getTime())) return { valid: false, error: 'Format de date invalide (attendu: YYYY-MM-DD)' };

    const now = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(now.getFullYear() - 1);

    const dateOnly = new Date(date); dateOnly.setHours(0, 0, 0, 0);
    const todayOnly = new Date(now); todayOnly.setHours(0, 0, 0, 0);

    if (dateOnly > todayOnly) return { valid: false, error: 'Date future non autorisée' };
    if (date < oneYearAgo) return { valid: false, error: 'Date trop ancienne (limite: 1 an)' };

    return { valid: true, date };
  }

  /**
   * Mapping type de compte → champs du DailySnapshot.
   * Doit rester synchronisé avec TransactionService.getTypeToSnapshotField().
   */
  getTypeToSnapshotField() {
    return {
      'LIQUIDE':       ['liquideDebut',       'liquideFin'       ],
      'ORANGE_MONEY':  ['orangeMoneyDebut',   'orangeMoneyFin'   ],
      'WAVE':          ['waveDebut',          'waveFin'          ],
      'UV_MASTER':     ['uvMasterDebut',      'uvMasterFin'      ],
      'AUTRES':        ['autresDebut',        'autresFin'        ],
      'FREE_MONEY':    ['freeMoneyDebut',     'freeMoneyFin'     ],
      'WESTERN_UNION': ['westernUnionDebut',  'westernUnionFin'  ],
      'RIA':           ['riaDebut',           'riaFin'           ],
      'MONEYGRAM':     ['moneygramDebut',     'moneygramFin'     ],
      'WESTERN_2':     ['westernUnion2Debut', 'westernUnion2Fin' ],
      'RIA_2':         ['ria2Debut',          'ria2Fin'          ],
    };
  }

  /**
   * Structure vide pour créer un DailySnapshot s'il n'existe pas encore.
   */
  emptySnapshotData(userId, date) {
    return {
      date, userId,
      liquideDebut: 0n, liquideFin: 0n,
      orangeMoneyDebut: 0n, orangeMoneyFin: 0n,
      waveDebut: 0n, waveFin: 0n,
      uvMasterDebut: 0n, uvMasterFin: 0n,
      autresDebut: 0n, autresFin: 0n,
      freeMoneyDebut: 0n, freeMoneyFin: 0n,
      westernUnionDebut: 0n, westernUnionFin: 0n,
      riaDebut: 0n, riaFin: 0n,
      moneygramDebut: 0n, moneygramFin: 0n,
      westernUnion2Debut: 0n, westernUnion2Fin: 0n,
      ria2Debut: 0n, ria2Fin: 0n,
      debutTotal: 0n, sortieTotal: 0n, grTotal: 0n
    };
  }

  // ── Point d'entrée principal ────────────────────────────────────────────

  /**
   * Crée une transaction pour une date passée.
   * Réservé à l'ADMIN (cohérent avec updateAccountLine/deleteAccountLine
   * qui interdisent déjà aux superviseurs de modifier des données passées).
   *
   * @param {string} adminId - id de l'admin qui crée la transaction
   * @param {object} data
   *   - superviseurId, typeCompte, typeOperation ('depot'|'retrait'), montant
   *   - partenaireId, partenaireNom, telephoneLibre (transactions partenaire)
   *   - finSecondaire (optionnel, pour 'retrait' sur compte fixe)
   *   - targetDate (obligatoire, doit être une date passée)
   */
  async createPastTransaction(adminId, data) {
    const {
      superviseurId, typeCompte, typeOperation, montant,
      partenaireId, partenaireNom, telephoneLibre, finSecondaire, targetDate
    } = data;

    // ── Validations de base ────────────────────────────────────────────
    const dateValidation = this.validateTargetDate(targetDate);
    if (!dateValidation.valid) throw new Error(dateValidation.error);
    if (!this.isPastDate(targetDate)) {
      throw new Error('Cette date n\'est pas une date passée. Utilisez la création de transaction normale pour aujourd\'hui.');
    }

    if (!superviseurId) throw new Error('superviseurId requis');
    if (!['depot', 'retrait'].includes(typeOperation)) throw new Error('typeOperation doit être "depot" ou "retrait"');

    const montantFloat = parseFloat(montant);
    if (isNaN(montantFloat) || montantFloat <= 0) throw new Error('Montant invalide');
    const montantInt = this.convertToInt(montantFloat);

    const isPartnerTransaction = !!(partenaireId || partenaireNom);
    if (!isPartnerTransaction && !typeCompte) {
      throw new Error('Type de compte requis pour une transaction début/fin journée');
    }

    const supervisor = await prisma.user.findUnique({
      where: { id: superviseurId, role: 'SUPERVISEUR' },
      select: { id: true, nomComplet: true }
    });
    if (!supervisor) throw new Error('Superviseur non trouvé');

    const snapshotDate = new Date(targetDate);
    snapshotDate.setHours(0, 0, 0, 0);
    const dateStr = snapshotDate.toISOString().split('T')[0];

    // S'assure qu'un snapshot existe pour cette date (sinon le crée vide)
    let snapshot = await prisma.dailySnapshot.findUnique({
      where: { userId_date: { userId: superviseurId, date: snapshotDate } }
    });
    if (!snapshot) {
      snapshot = await prisma.dailySnapshot.create({
        data: this.emptySnapshotData(superviseurId, snapshotDate)
      });
    }

    // Horodatage de la transaction archivée : midi ce jour-là,
    // pour rester bien à l'intérieur de la fenêtre du jour (évite les bornes de reset)
    const archivedCreatedAt = new Date(snapshotDate);
    archivedCreatedAt.setHours(12, 0, 0, 0);

    if (isPartnerTransaction) {
      return this._createPastPartnerTransaction({
        adminId, supervisor, superviseurId, typeOperation, montantFloat, montantInt,
        partenaireId, partenaireNom, telephoneLibre,
        snapshot, snapshotDate, dateStr, archivedCreatedAt
      });
    }

    return this._createPastAccountTransaction({
      adminId, supervisor, superviseurId, typeCompte, typeOperation, montantFloat, montantInt,
      finSecondaire, snapshot, snapshotDate, dateStr, archivedCreatedAt
    });
  }

  // ── Transaction partenaire sur date passée ──────────────────────────────

  async _createPastPartnerTransaction({
    adminId, supervisor, superviseurId, typeOperation, montantFloat, montantInt,
    partenaireId, partenaireNom, telephoneLibre,
    snapshot, snapshotDate, dateStr, archivedCreatedAt
  }) {
    let partner = null;
    let partnerDisplayName = '';

    if (partenaireId) {
      partner = await prisma.user.findUnique({
        where: { id: partenaireId, role: 'PARTENAIRE' },
        select: { id: true, nomComplet: true }
      });
      if (!partner) throw new Error('Partenaire enregistré non trouvé');
      partnerDisplayName = partner.nomComplet;
    } else {
      partnerDisplayName = (partenaireNom || '').trim();
      if (partnerDisplayName.length < 2) throw new Error('Nom du partenaire invalide (minimum 2 caractères)');
    }

    const transactionType = typeOperation === 'depot' ? 'DEPOT' : 'RETRAIT';
    const description = `${typeOperation === 'depot' ? 'Dépôt' : 'Retrait'} partenaire ${partnerDisplayName} (${dateStr})`;

    const tx = await prisma.transaction.create({
      data: {
        montant: montantInt,
        type: transactionType,
        description,
        envoyeurId: adminId,
        destinataireId: superviseurId,
        archived: true,
        archivedAt: new Date(),
        createdAt: archivedCreatedAt,
        ...(partenaireId
          ? { partenaireId }
          : { partenaireNom: partnerDisplayName, ...(telephoneLibre?.trim() && { telephoneLibre: telephoneLibre.trim() }) }
        ),
        metadata: JSON.stringify({
          action: 'CREATE_PAST_PARTNER_TRANSACTION',
          typeOperation, montant: montantFloat, targetDate: dateStr,
          createdBy: adminId, createdAt: new Date().toISOString()
        })
      }
    });

    // Incrémente le total du snapshot (debutTotal pour dépôt, sortieTotal pour retrait)
    const field = typeOperation === 'depot' ? 'debutTotal' : 'sortieTotal';
    const oldFieldVal = this.convertFromInt(snapshot[field]);
    const newFieldVal = oldFieldVal + montantFloat;

    const newDebutTotal  = field === 'debutTotal'  ? newFieldVal : this.convertFromInt(snapshot.debutTotal);
    const newSortieTotal = field === 'sortieTotal' ? newFieldVal : this.convertFromInt(snapshot.sortieTotal);

    await prisma.dailySnapshot.update({
      where: { userId_date: { userId: superviseurId, date: snapshotDate } },
      data: {
        [field]:     BigInt(Math.round(newFieldVal * 100)),
        debutTotal:  BigInt(Math.round(newDebutTotal  * 100)),
        sortieTotal: BigInt(Math.round(newSortieTotal * 100)),
        grTotal:     BigInt(Math.round((newSortieTotal - newDebutTotal) * 100))
      }
    });

    setImmediate(async () => {
      try {
        await NotificationService.createNotification({
          userId: superviseurId,
          title: '📝 Transaction ajoutée (date passée)',
          message: `${typeOperation === 'depot' ? 'Dépôt' : 'Retrait'} partenaire ${partnerDisplayName} de ${this.formatAmount(montantFloat)} le ${dateStr}`,
          type: typeOperation === 'depot' ? 'DEPOT_PARTENAIRE' : 'RETRAIT_PARTENAIRE'
        });
      } catch (e) { console.error('❌ [PAST TX] Erreur notification (non bloquant):', e); }
    });

    return {
      transaction: {
        id: tx.id, type: tx.type, montant: montantFloat, description,
        targetDate: dateStr, isPartnerTransaction: true,
        partnerName: partnerDisplayName, partnerId: partenaireId || null,
        superviseurNom: supervisor.nomComplet
      },
      snapshotUpdated: true
    };
  }

  // ── Transaction compte fixe sur date passée ─────────────────────────────

  async _createPastAccountTransaction({
    adminId, supervisor, superviseurId, typeCompte, typeOperation, montantFloat, montantInt,
    finSecondaire, snapshot, snapshotDate, dateStr, archivedCreatedAt
  }) {
    const typeUpper = typeCompte.toUpperCase();
    const fieldMap = this.getTypeToSnapshotField();
    const fields = fieldMap[typeUpper];
    if (!fields) throw new Error(`Type de compte "${typeUpper}" non supporté pour une date passée`);

    const [debutField, finField] = fields;
    const targetField = typeOperation === 'depot' ? debutField : finField;

    const oldFieldVal = this.convertFromInt(snapshot[targetField]);
    const newFieldVal = oldFieldVal + montantFloat;

    const oldDebutTotal  = this.convertFromInt(snapshot.debutTotal);
    const oldSortieTotal = this.convertFromInt(snapshot.sortieTotal);
    const newDebutTotal  = typeOperation === 'depot'   ? oldDebutTotal  + montantFloat : oldDebutTotal;
    const newSortieTotal = typeOperation === 'retrait' ? oldSortieTotal + montantFloat : oldSortieTotal;

    await prisma.dailySnapshot.update({
      where: { userId_date: { userId: superviseurId, date: snapshotDate } },
      data: {
        [targetField]: BigInt(Math.round(newFieldVal * 100)),
        debutTotal:    BigInt(Math.round(newDebutTotal  * 100)),
        sortieTotal:   BigInt(Math.round(newSortieTotal * 100)),
        grTotal:       BigInt(Math.round((newSortieTotal - newDebutTotal) * 100))
      }
    });

    // Gestion F2 (uniquement pertinent pour "retrait" / Fin de journée)
    let f2Val = null;
    if (typeOperation === 'retrait' && finSecondaire != null) {
      const f2Float = parseFloat(finSecondaire);
      if (!isNaN(f2Float) && f2Float > 0) {
        const f2Key = `snapshot_f2_${superviseurId}_${dateStr}`;
        const existing = await prisma.systemConfig.findFirst({ where: { key: f2Key } });
        const f2Data = existing?.value ? JSON.parse(existing.value) : {};
        // Le F2 s'additionne au F2 déjà connu pour cette date, comme F1
        const prevF2 = f2Data[typeUpper] ? this.convertFromInt(BigInt(f2Data[typeUpper])) : 0;
        const combinedF2 = prevF2 + f2Float;
        f2Data[typeUpper] = String(Math.round(combinedF2 * 100));
        await prisma.systemConfig.upsert({
          where:  { key: f2Key },
          update: { value: JSON.stringify(f2Data) },
          create: { key: f2Key, value: JSON.stringify(f2Data) }
        });
        f2Val = combinedF2;
      }
    }

    const tx = await prisma.transaction.create({
      data: {
        montant: montantInt,
        type: typeOperation === 'depot' ? 'DEBUT_JOURNEE' : 'FIN_JOURNEE',
        description: `${typeOperation === 'depot' ? 'Début' : 'Fin'} journée ${typeUpper} (${dateStr})`,
        envoyeurId: adminId,
        destinataireId: superviseurId,
        archived: true,
        archivedAt: new Date(),
        createdAt: archivedCreatedAt,
        metadata: JSON.stringify({
          action: 'CREATE_PAST_ACCOUNT_TRANSACTION',
          typeCompte: typeUpper, typeOperation, montant: montantFloat,
          targetDate: dateStr, finSecondaire: f2Val,
          createdBy: adminId, createdAt: new Date().toISOString()
        })
      }
    });

    setImmediate(async () => {
      try {
        await NotificationService.createNotification({
          userId: superviseurId,
          title: '📝 Transaction ajoutée (date passée)',
          message: `${typeOperation === 'depot' ? 'Début journée' : 'Fin journée'} ${typeUpper} : ${this.formatAmount(montantFloat)} le ${dateStr}`,
          type: 'AUDIT_MODIFICATION'
        });
      } catch (e) { console.error('❌ [PAST TX] Erreur notification (non bloquant):', e); }
    });

    return {
      transaction: {
        id: tx.id, type: tx.type, montant: montantFloat, typeCompte: typeUpper,
        targetDate: dateStr, isPartnerTransaction: false,
        superviseurNom: supervisor.nomComplet
      },
      snapshotUpdated: true,
      finSecondaire: f2Val
    };
  }
}

export default new PastTransactionService();