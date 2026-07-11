// src/routes/pastTransaction.routes.js
//
// Route dédiée à la création de transactions sur une date passée.

import express from 'express';
import PastTransactionController from '../controllers/PastTransactionController.js';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// POST /api/transactions/past
// Body: { superviseurId, typeCompte?, typeOperation, montant, partenaireId?, partenaireNom?, telephoneLibre?, finSecondaire?, targetDate }
//
// requireAdmin est ajouté ici en plus de la vérification faite dans le contrôleur :
// double sécurité, cohérent avec le reste de tes routes (ex: /admin/create).
router.post('/past', authenticateToken, requireAdmin, PastTransactionController.createPastTransaction);

export default router;