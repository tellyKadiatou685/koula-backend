// src/controllers/PastTransactionController.js
//
// Contrôleur dédié à la création de transactions sur une date passée.
// Ne touche à aucun contrôleur existant.

import PastTransactionService from '../services/PastTransactionService.js';

class PastTransactionController {

  /**
   * POST /api/transactions/past
   * Body attendu:
   * {
   *   superviseurId, typeCompte, typeOperation ('depot'|'retrait'), montant,
   *   partenaireId?, partenaireNom?, telephoneLibre?, finSecondaire?,
   *   targetDate  (obligatoire, format 'YYYY-MM-DD', doit être une date passée)
   * }
   *
   * Réservé à l'ADMIN (les superviseurs ne peuvent pas modifier des données
   * passées, cohérent avec updateAccountLine/deleteAccountLine).
   */
  async createPastTransaction(req, res) {
    try {
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({
          success: false,
          message: 'Seul un administrateur peut créer une transaction pour une date passée'
        });
      }

      const {
        superviseurId,
        typeCompte,
        typeOperation,
        montant,
        partenaireId,
        partenaireNom,
        telephoneLibre,
        finSecondaire,
        targetDate,
      } = req.body;

      // ── Validations de forme (avant d'appeler le service) ──────────────
      const validationErrors = [];

      if (!targetDate) validationErrors.push('targetDate requis');
      if (!superviseurId) validationErrors.push('superviseurId requis');

      const hasPartenaireId  = !!partenaireId;
      const hasPartenaireNom = !!partenaireNom;
      const isPartnerTransaction = hasPartenaireId || hasPartenaireNom;

      if (hasPartenaireId && hasPartenaireNom) {
        validationErrors.push('Choisissez soit un partenaire enregistré, soit un nom libre (pas les deux)');
      }
      if (!isPartnerTransaction && !typeCompte) {
        validationErrors.push('typeCompte requis pour transactions début/fin journée');
      }
      if (!typeOperation) validationErrors.push('typeOperation requis');
      if (!montant) validationErrors.push('montant requis');

      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Données manquantes: ' + validationErrors.join(', ')
        });
      }

      const montantFloat = parseFloat(montant);
      if (isNaN(montantFloat) || montantFloat <= 0) {
        return res.status(400).json({ success: false, message: 'Le montant doit être un nombre positif' });
      }

      if (!['depot', 'retrait'].includes(typeOperation)) {
        return res.status(400).json({ success: false, message: 'typeOperation doit être "depot" ou "retrait"' });
      }

      // Vérifier que c'est bien une date passée (pas aujourd'hui, pas future)
      let isPast;
      try {
        isPast = PastTransactionService.isPastDate(targetDate);
      } catch (e) {
        return res.status(400).json({ success: false, message: e.message });
      }
      if (!isPast) {
        return res.status(400).json({
          success: false,
          message: 'targetDate doit être une date strictement antérieure à aujourd\'hui. Utilisez la route de création normale pour aujourd\'hui.'
        });
      }

      // ── Appel service ────────────────────────────────────────────────
      const result = await PastTransactionService.createPastTransaction(req.user.id, {
        superviseurId,
        typeCompte:     isPartnerTransaction ? null : typeCompte.toUpperCase(),
        typeOperation,
        montant:        montantFloat,
        partenaireId:   partenaireId   || null,
        partenaireNom:  partenaireNom  || null,
        telephoneLibre: telephoneLibre || null,
        finSecondaire:  finSecondaire  ?? null,
        targetDate,
      });

      const operationLabel = typeOperation === 'depot' ? 'Dépôt' : 'Retrait';
      const transactionTypeLabel = isPartnerTransaction
        ? `${operationLabel} partenaire`
        : `${operationLabel} journée`;

      res.status(201).json({
        success: true,
        message: `${transactionTypeLabel} créé avec succès pour le ${targetDate}`,
        data: result
      });

    } catch (error) {
      console.error('❌ [PAST TX CONTROLLER] Erreur createPastTransaction:', error);

      const errorMappings = {
        'Superviseur non trouvé':            { status: 404, message: 'Superviseur non trouvé ou inactif' },
        'Partenaire non trouvé':             { status: 404, message: 'Partenaire enregistré non trouvé ou inactif' },
        'Seul un administrateur peut créer': { status: 403, message: error.message },
        'non supporté pour une date passée': { status: 400, message: error.message },
        'Date invalide':                     { status: 400, message: error.message },
        'Date future':                       { status: 400, message: error.message },
        'Date trop ancienne':                { status: 400, message: error.message },
        'Nom du partenaire invalide':        { status: 400, message: error.message },
        'Montant invalide':                  { status: 400, message: error.message },
      };

      for (const [errorKey, errorResponse] of Object.entries(errorMappings)) {
        if (error.message.includes(errorKey)) {
          return res.status(errorResponse.status).json({ success: false, message: errorResponse.message });
        }
      }

      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la création de la transaction datée'
      });
    }
  }
}

export default new PastTransactionController();