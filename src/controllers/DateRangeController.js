// src/controllers/DateRangeController.js
//
// Contrôleur dédié aux totaux cumulés sur une plage de dates.
// Fichier isolé, ne modifie aucun contrôleur existant.

import DateRangeService from '../services/DateRangeService.js';

class DateRangeController {

  /**
   * GET /api/transactions/supervisor/:supervisorId/range-totals?startDate=...&endDate=...
   *
   * Accessible à l'ADMIN (n'importe quel superviseur) ou au SUPERVISEUR
   * lui-même (ses propres totaux uniquement).
   */
  async getSupervisorRangeTotals(req, res) {
    try {
      const { supervisorId } = req.params;
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: 'startDate et endDate requis (format YYYY-MM-DD)'
        });
      }

      if (req.user.role !== 'ADMIN' && req.user.id !== supervisorId) {
        return res.status(403).json({
          success: false,
          message: 'Vous ne pouvez consulter que vos propres totaux'
        });
      }

      const result = await DateRangeService.getSupervisorRangeTotals(
        supervisorId, startDate, endDate
      );

      res.json({
        success: true,
        message: `Totaux cumulés du ${result.startDate} au ${result.endDate}`,
        data: result
      });

    } catch (error) {
      console.error('❌ [DateRangeController] Erreur getSupervisorRangeTotals:', error);

      const status =
        error.message.includes('non trouvé')  ? 404 :
        error.message.includes('invalide')    ? 400 :
        error.message.includes('futur')       ? 400 :
        error.message.includes('trop ancienne') ? 400 :
        500;

      res.status(status).json({ success: false, message: error.message });
    }
  }
}

export default new DateRangeController();