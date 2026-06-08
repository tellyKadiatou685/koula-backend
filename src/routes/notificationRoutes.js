// src/routes/notificationRoutes.js
import express from 'express';
import NotificationService from '../services/NotificationService.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);

// ─── GET /api/notifications ────────────────────────────────────────────────
// ?page=1&limit=20&unreadOnly=true&type=DEPOT_PARTENAIRE
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly, type } = req.query;
    const result = await NotificationService.getNotifications(req.user.id, {
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
      unreadOnly: unreadOnly === 'true',
      type: type || null
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/notifications/unread-count ──────────────────────────────────
router.get('/unread-count', async (req, res) => {
  try {
    const count = await NotificationService.getUnreadCount(req.user.id);
    res.json({ count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PATCH /api/notifications/:id/read ────────────────────────────────────
router.patch('/:id/read', async (req, res) => {
  try {
    const result = await NotificationService.markAsRead(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(err.message === 'Accès refusé' ? 403 : 404).json({ success: false, message: err.message });
  }
});

// ─── PATCH /api/notifications/read-all ────────────────────────────────────
router.patch('/read-all', async (req, res) => {
  try {
    const result = await NotificationService.markAllAsRead(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PATCH /api/notifications/read-many ───────────────────────────────────
// Body: { ids: ["id1", "id2"] }
router.patch('/read-many', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids requis (tableau)' });
    }
    const result = await NotificationService.markManyAsRead(ids, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE /api/notifications/:id ────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const result = await NotificationService.deleteNotification(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(err.message === 'Accès refusé' ? 403 : 404).json({ success: false, message: err.message });
  }
});

// ─── DELETE /api/notifications/delete-many ────────────────────────────────
// Body: { ids: ["id1", "id2"] }
router.delete('/delete-many', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids requis (tableau)' });
    }
    const result = await NotificationService.deleteManyNotifications(ids, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE /api/notifications/delete-read ────────────────────────────────
router.delete('/delete-read', async (req, res) => {
  try {
    const result = await NotificationService.deleteReadNotifications(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE /api/notifications/delete-all ─────────────────────────────────
router.delete('/delete-all', async (req, res) => {
  try {
    const result = await NotificationService.deleteAllNotifications(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;