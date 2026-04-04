// src/controllers/PartnerBalanceController.js
import PartnerBalanceService from '../services/PartnerBalanceService.js';

class PartnerBalanceController {

  // ─────────────────────────────────────────────────────────────────
  // GET /api/partner-balance
  // ─────────────────────────────────────────────────────────────────
  async getAllPartnersBalances(req, res) {
    try {
      const results = await PartnerBalanceService.getAllPartnersBalances();
      res.json({
        success: true,
        message: `${results.length} solde(s) partenaires récupérés`,
        data: { partners: results }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // GET /api/partner-balance/:partenaireId
  // ─────────────────────────────────────────────────────────────────
  async getPartnerBalance(req, res) {
    try {
      const { partenaireId } = req.params;
      if (!partenaireId)
        return res.status(400).json({ success: false, message: 'ID partenaire requis' });

      const result = await PartnerBalanceService.getPartnerBalance(partenaireId);
      res.json({
        success: true,
        message: `Solde de ${result.partenaire.nomComplet} récupéré`,
        data: result
      });
    } catch (error) {
      const status = error.message.includes('introuvable') ? 404 : 500;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // GET /api/partner-balance/:partenaireId/history
  //
  // Query params optionnels :
  //   ?type=DEPOT             → filtre par type (DEPOT | RETRAIT)
  //   ?dateDebut=2024-01-01   → début de plage (YYYY-MM-DD)
  //   ?dateFin=2024-01-31     → fin de plage   (YYYY-MM-DD)
  //
  // Exemples :
  //   /history
  //   /history?type=DEPOT
  //   /history?dateDebut=2024-01-01&dateFin=2024-01-31
  //   /history?type=RETRAIT&dateDebut=2024-01-15
  // ─────────────────────────────────────────────────────────────────
  async getPartnerHistory(req, res) {
    try {
      const { partenaireId }           = req.params;
      const { type, dateDebut, dateFin } = req.query;

      if (!partenaireId)
        return res.status(400).json({ success: false, message: 'ID partenaire requis' });

      // Validation du filtre type
      if (type && !['DEPOT', 'RETRAIT'].includes(type.toUpperCase())) {
        return res.status(400).json({
          success: false,
          message: "Le filtre 'type' doit être DEPOT ou RETRAIT"
        });
      }

      // Validation des dates si fournies
      if (dateDebut && isNaN(new Date(dateDebut).getTime())) {
        return res.status(400).json({
          success: false,
          message: "Format dateDebut invalide — utilisez YYYY-MM-DD"
        });
      }
      if (dateFin && isNaN(new Date(dateFin).getTime())) {
        return res.status(400).json({
          success: false,
          message: "Format dateFin invalide — utilisez YYYY-MM-DD"
        });
      }

      const result = await PartnerBalanceService.getPartnerHistory(partenaireId, {
        type:      type      ?? null,
        dateDebut: dateDebut ?? null,
        dateFin:   dateFin   ?? null,
      });

      res.json({
        success: true,
        message: `Historique de ${result.partenaire.nomComplet} récupéré (${result.statistiques.nombreTransactions} transaction(s))`,
        data: result
      });
    } catch (error) {
      const status = error.message.includes('introuvable') ? 404 : 500;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // POST /api/partner-balance/:partenaireId/transaction
  //
  // Body : { type: 'depot' | 'retrait', montant: number, commentaire?: string }
  //
  // ✅ Sans destinataireId → n'impacte AUCUN superviseur
  // ✅ commentaire optionnel → visible dans l'historique partenaire uniquement
  // ─────────────────────────────────────────────────────────────────
  async createAdminDirectTransaction(req, res) {
    try {
      const { partenaireId }              = req.params;
      const { type, montant, commentaire } = req.body;
      const adminId                        = req.user?.id;

      if (!partenaireId)
        return res.status(400).json({ success: false, message: 'ID partenaire requis' });

      if (!adminId)
        return res.status(401).json({ success: false, message: 'Non authentifié' });

      if (!type || !['depot', 'retrait'].includes(type))
        return res.status(400).json({
          success: false,
          message: "Type invalide — valeurs acceptées : 'depot' ou 'retrait'"
        });

      const montantFloat = parseFloat(montant);
      if (!montant || isNaN(montantFloat) || montantFloat <= 0)
        return res.status(400).json({
          success: false,
          message: 'Montant invalide — doit être un nombre positif'
        });

      // Validation longueur commentaire si fourni
      if (commentaire && commentaire.trim().length > 200) {
        return res.status(400).json({
          success: false,
          message: 'Commentaire trop long — maximum 200 caractères'
        });
      }

      const result = await PartnerBalanceService.createAdminDirectTransaction(
        adminId,
        partenaireId,
        type,
        montantFloat,
        commentaire ?? null   // ← commentaire optionnel
      );

      res.status(201).json({
        success: true,
        message: `${type === 'depot' ? 'Dépôt' : 'Retrait'} de ${montantFloat.toLocaleString('fr-FR')} F effectué pour ${result.partenaire}`,
        data: result
      });

    } catch (error) {
      const status =
        error.message.includes('introuvable') ? 404 :
        error.message.includes('suspendu')    ? 403 :
        error.message.includes('invalide')    ? 400 : 500;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // PATCH /api/partner-balance/transaction/:transactionId/montant
  //
  // Body : { montant: number }
  // Auth : ADMIN ou SUPERVISEUR propriétaire
  //
  // Comportement :
  //   - Modifie le montant de la transaction
  //   - Si superviseur impliqué → recompute snapshot → card mise à jour
  //   - Si transaction admin directe → impact historique partenaire uniquement
  // ─────────────────────────────────────────────────────────────────
  async updateTransactionMontant(req, res) {
    try {
      const { transactionId } = req.params;
      const { montant }       = req.body;
      const requesterId       = req.user?.id;

      if (!requesterId)
        return res.status(401).json({ success: false, message: 'Non authentifié' });

      if (montant === undefined || montant === null)
        return res.status(400).json({ success: false, message: 'Le champ montant est requis' });

      const montantFloat = parseFloat(montant);
      if (isNaN(montantFloat) || montantFloat <= 0)
        return res.status(400).json({
          success: false,
          message: 'Montant invalide — doit être un nombre positif'
        });

      const result = await PartnerBalanceService.updateTransactionMontant(
        transactionId,
        montantFloat,
        requesterId
      );

      res.json({
        success: true,
        message: `Montant modifié : ${result.ancienMontant.toLocaleString('fr-FR')} F → ${result.nouveauMontant.toLocaleString('fr-FR')} F`,
        data: result
      });

    } catch (error) {
      const status =
        error.message.includes('introuvable') ? 404 :
        error.message.includes('Permission')  ? 403 :
        error.message.includes('supprimée')   ? 409 :
        error.message.includes('identique')   ? 400 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // DELETE /api/partner-balance/transaction/:transactionId
  //
  // Auth : ADMIN ou SUPERVISEUR propriétaire
  //
  // Comportement :
  //   - Suppression LOGIQUE → préfixe [SUPPRIMÉ] dans la description
  //   - Si superviseur impliqué → recompute snapshot → card mise à jour
  //   - Si transaction admin directe → aucun impact sur les cards
  // ─────────────────────────────────────────────────────────────────
  async deleteTransaction(req, res) {
    try {
      const { transactionId } = req.params;
      const requesterId       = req.user?.id;

      if (!requesterId)
        return res.status(401).json({ success: false, message: 'Non authentifié' });

      const result = await PartnerBalanceService.deleteTransaction(
        transactionId,
        requesterId
      );

      res.json({
        success: true,
        message: result.message,
        data: result
      });

    } catch (error) {
      const status =
        error.message.includes('introuvable')    ? 404 :
        error.message.includes('Permission')     ? 403 :
        error.message.includes('Vous ne pouvez') ? 403 :
        error.message.includes('déjà supprimée') ? 409 : 400;
      res.status(status).json({ success: false, message: error.message });
    }
  }
}

export default new PartnerBalanceController();