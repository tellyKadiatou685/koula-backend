// src/routes/accountLines.js
import express from 'express';
import AccountLineController from '../controllers/AccountLineController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// =====================================
// ROUTES POUR GESTION DES LIGNES DE COMPTE
// =====================================

/**
 * @route   DELETE /api/account-lines/supervisor/:supervisorId/:lineType
 * @desc    Supprimer une ligne (remet à zéro + archive les tx partenaire)
 * @access  Admin | Superviseur (ses propres comptes seulement)
 * @params  supervisorId  - ID du superviseur
 * @params  lineType      - 'debut' | 'sortie'
 * @body    accountKey    - 'LIQUIDE' | 'WAVE' | 'part-NomPartenaire' | …
 */
router.delete(
  '/supervisor/:supervisorId/:lineType',
  authenticateToken,
  AccountLineController.deleteAccountLine
);

/**
 * @route   PUT /api/account-lines/supervisor/:supervisorId/:lineType/reset
 * @desc    Réinitialiser une ligne à une valeur précise (0 par défaut)
 * @access  Admin seulement
 * @params  supervisorId  - ID du superviseur
 * @params  lineType      - 'debut' | 'sortie'
 * @body    accountKey    - Clé du compte
 * @body    newValue      - Nouvelle valeur (optionnel, défaut: 0)
 */
router.put(
  '/supervisor/:supervisorId/:lineType/reset',
  authenticateToken,
  AccountLineController.resetAccountLine
);

/**
 * @route   PATCH /api/account-lines/supervisor/:supervisorId/:lineType/update
 * @desc    Modifier la valeur d'une ligne SANS toucher aux transactions passées.
 *          Crée un enregistrement AUDIT_MODIFICATION.
 * @access  Admin | Superviseur (ses propres comptes seulement)
 * @params  supervisorId  - ID du superviseur
 * @params  lineType      - 'debut' | 'sortie'
 * @body    accountKey    - Clé du compte
 * @body    newValue      - Nouvelle valeur en francs (≥ 0)
 * @body    reason        - Raison de la modification (optionnel)
 */
router.patch(
  '/supervisor/:supervisorId/:lineType/update',
  authenticateToken,
  AccountLineController.updateAccountLine
);

/**
 * @route   GET /api/account-lines/deletion-history
 * @desc    Historique des suppressions et modifications de lignes
 * @access  Admin seulement
 * @query   page         - Numéro de page (défaut: 1)
 * @query   limit        - Éléments par page (défaut: 20)
 * @query   supervisorId - Filtrer par superviseur (optionnel)
 */
router.get(
  '/deletion-history',
  authenticateToken,
  AccountLineController.getAccountDeletionHistory
);

// =====================================
// EXEMPLES D'UTILISATION
// =====================================
/*
  ── Supprimer une ligne début LIQUIDE ──────────────────────────────────
  DELETE /api/account-lines/supervisor/abc123/debut
  Body: { "accountKey": "LIQUIDE" }

  ── Supprimer une ligne sortie partenaire ──────────────────────────────
  DELETE /api/account-lines/supervisor/abc123/sortie
  Body: { "accountKey": "part-Jean Dupont" }

  ── Réinitialiser à zéro ───────────────────────────────────────────────
  PUT /api/account-lines/supervisor/abc123/debut/reset
  Body: { "accountKey": "ORANGE_MONEY" }

  ── Réinitialiser à 5000 F ─────────────────────────────────────────────
  PUT /api/account-lines/supervisor/abc123/sortie/reset
  Body: { "accountKey": "WAVE", "newValue": 5000 }

  ── ✏️ Modifier la valeur d'une ligne (sans toucher aux tx passées) ────
  PATCH /api/account-lines/supervisor/abc123/debut/update
  Body: { "accountKey": "LIQUIDE", "newValue": 15000, "reason": "Correction saisie" }

  PATCH /api/account-lines/supervisor/abc123/sortie/update
  Body: { "accountKey": "part-Jean Dupont", "newValue": 8000 }

  ── Historique d'audit ─────────────────────────────────────────────────
  GET /api/account-lines/deletion-history?page=1&limit=10
  GET /api/account-lines/deletion-history?supervisorId=abc123
*/

export default router;