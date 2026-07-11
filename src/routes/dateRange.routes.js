// src/routes/dateRange.routes.js
//
// Route dédiée aux totaux cumulés sur une plage de dates.

import express from 'express';
import DateRangeController from '../controllers/DateRangeController.js';
import { authenticateToken, requireSupervisorOrAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET /api/transactions/supervisor/:supervisorId/range-totals?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get(
  '/supervisor/:supervisorId/range-totals',
  authenticateToken,
  requireSupervisorOrAdmin,
  DateRangeController.getSupervisorRangeTotals
);

export default router;