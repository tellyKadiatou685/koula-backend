// src/routes/userRoutes.js
import express from 'express';
import UserController from '../controllers/UserController.js';
import { 
  authenticateToken, 
  requireAdmin, 
  requireSupervisor, 
  requirePartner,
  requireSupervisorOrAdmin 
} from '../middleware/auth.js';
import { 
  validateLogin, 
  validateRegistration, 
  validateCreateUser,
  handleValidationErrors 
} from '../middleware/validation.js';

const router = express.Router();
router.put('/:userId', authenticateToken, UserController.updateUser);

// =====================================
// ROUTES PUBLIQUES
// =====================================

router.post('/login', validateLogin, handleValidationErrors, UserController.login);
router.post('/register-request', validateRegistration, handleValidationErrors, UserController.requestRegistration);

// =====================================
// ROUTES AUTHENTIFIÉES (tous les rôles)
// =====================================

router.post('/logout', authenticateToken, UserController.logout);
router.get('/profile',  authenticateToken, UserController.getProfile);


// ✏️ Mise à jour profil — nom, téléphone, adresse, photo (sauf code)
router.patch('/profile', authenticateToken, UserController.updateProfile);

// =====================================
// NOTIFICATIONS
// =====================================

router.get('/notifications', authenticateToken, UserController.getNotifications);
router.patch('/notifications/:notificationId/read', authenticateToken, UserController.markNotificationRead);

// =====================================
// SUPERVISEUR + ADMIN
// =====================================

router.get('/partners', authenticateToken, requireSupervisorOrAdmin, UserController.getPartners);

// =====================================
// ADMIN SEULEMENT
// =====================================

router.get('/registration-requests',                        authenticateToken, requireAdmin, UserController.getPendingRegistrations);
router.patch('/registration-requests/:requestId/approve',   authenticateToken, requireAdmin, UserController.approveRegistration);
router.patch('/registration-requests/:requestId/reject',    authenticateToken, requireAdmin, UserController.rejectRegistration);
router.post('/create',                                      authenticateToken, requireAdmin, validateCreateUser, handleValidationErrors, UserController.createUser);
router.get('/all',                                          authenticateToken, requireAdmin, UserController.getAllUsers);
router.patch('/:userId/suspend',                            authenticateToken, requireAdmin, UserController.suspendUser);
router.patch('/:userId/activate',                           authenticateToken, requireAdmin, UserController.activateUser);
router.delete('/:userId',                                   authenticateToken, requireAdmin, UserController.deleteUser);
router.post('/broadcast-notification',                      authenticateToken, requireAdmin, UserController.broadcastNotification);

// Codes d'accès
router.get('/:userId/code',            authenticateToken, requireAdmin, UserController.getUserCode);
router.post('/:userId/regenerate-code',authenticateToken, requireAdmin, UserController.regenerateUserCode);
router.get('/codes/stats',             authenticateToken, requireAdmin, UserController.getCodesStats);
router.get('/codes/search',            authenticateToken, requireAdmin, UserController.findUserByCode);

// =====================================
// GESTION D'ERREURS
// =====================================

router.use((error, req, res, next) => {
  console.error('❌ Erreur dans userRoutes:', error);
  if (error.code === 'P2002') {
    return res.status(409).json({ success: false, message: 'Ce numéro de téléphone est déjà utilisé' });
  }
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Token invalide. Veuillez vous reconnecter.' });
  }
  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Session expirée. Veuillez vous reconnecter.' });
  }
  res.status(500).json({ success: false, message: 'Erreur interne du serveur' });
});

export default router;