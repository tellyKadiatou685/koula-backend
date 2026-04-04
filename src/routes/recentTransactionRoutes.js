// src/routes/recentTransactionRoutes.js
import express from 'express';
import RecentTransactionController from '../controllers/RecentTransactionController.js';
import { authenticateToken } from '../middleware/auth.js'; // Correction du chemin et du nom

const router = express.Router();

// Appliquer l'authentification à toutes les routes
router.use(authenticateToken);

// =====================================
// ROUTES PRINCIPALES POUR LE FILTRAGE AVANCÉ
// =====================================

/**
 * GET /api/transactions
 * Transactions avec filtrage avancé (pagination par défaut 20)
 * 
 * Paramètres supportés :
 * - search: Recherche textuelle globale
 * - supervisorId: ID du superviseur
 * - partnerId: ID du partenaire  
 * - operatorId: ID de l'opérateur
 * - supervisorName: Nom du superviseur
 * - partnerName: Nom du partenaire
 * - operatorName: Nom de l'opérateur
 * - userName: Recherche globale par nom
 * - type: Type de transaction (depot, retrait, transfert, allocation, all)
 * - period: Période (today, yesterday, week, month, year, all)
 * - accountType: Type de compte (LIQUIDE, ORANGE_MONEY, WAVE, UV_MASTER, all)
 * - page: Numéro de page (défaut: 1)
 * - limit: Nombre par page (défaut: 20, max: 100)
 * - sortBy: Champ de tri (défaut: createdAt)
 * - sortOrder: Ordre de tri (asc, desc - défaut: desc)
 */
router.get('/', RecentTransactionController.getRecentTransactions);

/**
 * GET /api/transactions/paginated
 * Pagination spécifique par 5 (pour le design frontend)
 * 
 * Mêmes paramètres que ci-dessus mais limite fixée à 5 par page
 * Paramètres :
 * - page: Numéro de page (défaut: 1)
 * - Tous les filtres de la route principale
 */
router.get('/paginated', RecentTransactionController.getTransactionsPaginatedByFive);

/**
 * GET /api/transactions/stats
 * Statistiques rapides pour les cartes du dashboard
 * 
 * Paramètres :
 * - period: Période pour les stats (today, yesterday, week, month, year, all)
 * 
 * Retourne :
 * - Total transactions
 * - Répartition par type (depot, retrait, transfert, allocation)
 * - Répartition par rôle (ADMIN, SUPERVISEUR, PARTENAIRE, OPERATEUR)
 * - Montants (total, entrées, sorties)
 */
router.get('/stats', RecentTransactionController.getTransactionStats);

// =====================================
// GESTION DES UTILISATEURS
// =====================================

/**
 * GET /api/transactions/users/all
 * Tous les utilisateurs pour peupler les select/dropdown
 * 
 * Accès : ADMIN, SUPERVISEUR uniquement
 * 
 * Retourne :
 * - superviseurs: Liste des superviseurs actifs
 * - partenaires: Liste des partenaires actifs  
 * - operateurs: Liste des opérateurs actifs
 * - totaux: Statistiques par rôle
 * 
 * Chaque utilisateur inclut :
 * - id, nom, telephone, email, role, status, dateCreation
 * - statistiques: totalTransactions, nombreComptes
 */
router.get('/users/all', RecentTransactionController.getAllUsers);

/**
 * GET /api/transactions/search
 * Recherche d'entités pour autocomplétion
 * 
 * Paramètres :
 * - q: Terme de recherche (minimum 2 caractères)
 * - type: Type d'entité (all, superviseur, partenaire, operateur)
 * - limit: Limite de résultats (défaut: 10)
 * 
 * Retourne :
 * - superviseurs: Résultats superviseurs
 * - partenaires: Résultats partenaires
 * - operateurs: Résultats opérateurs
 * - total: Nombre total de résultats
 */
router.get('/search', RecentTransactionController.searchEntities);

// =====================================
// EXPORT ET RAPPORTS
// =====================================

/**
 * GET /api/transactions/export
 * Export Excel/JSON avec tous les filtres appliqués
 * 
 * Accès : ADMIN, SUPERVISEUR uniquement
 * 
 * Paramètres : Tous les filtres de la route principale
 * 
 * Retourne :
 * - Format JSON avec metadata
 * - Nom de fichier généré automatiquement
 * - Jusqu'à 5000 transactions
 */
router.get('/export', RecentTransactionController.exportTransactions);

/**
 * GET /api/transactions/export/csv
 * Export CSV avec tous les filtres appliqués
 * 
 * Accès : ADMIN, SUPERVISEUR uniquement
 * 
 * Paramètres : Tous les filtres de la route principale
 * 
 * Retourne :
 * - Fichier CSV avec headers appropriés
 * - Téléchargement direct
 * - Jusqu'à 5000 transactions
 */
router.get('/export/csv', RecentTransactionController.exportTransactionsCSV);

// =====================================
// GESTION DES NOTIFICATIONS
// =====================================

/**
 * GET /api/transactions/notifications
 * Liste des notifications de l'utilisateur connecté
 * 
 * Paramètres :
 * - limit: Nombre de notifications (défaut: 10)
 * - unreadOnly: Seulement non lues (true/false)
 * 
 * Retourne :
 * - notifications: Liste formatée avec icônes et priorités
 * - unreadCount: Nombre de notifications non lues
 * - hasUnread: Boolean si notifications non lues
 */
router.get('/notifications', RecentTransactionController.getNotifications);

/**
 * PUT /api/transactions/notifications/:notificationId/read
 * Marquer une notification comme lue
 * 
 * Paramètres :
 * - notificationId: ID de la notification
 * 
 * Sécurité : Vérifie que la notification appartient à l'utilisateur
 */
router.put('/notifications/:notificationId/read', RecentTransactionController.markNotificationAsRead);

/**
 * PUT /api/transactions/notifications/read-all
 * Marquer toutes les notifications comme lues
 * 
 * Met à jour toutes les notifications non lues de l'utilisateur connecté
 */
router.put('/notifications/read-all', RecentTransactionController.markAllNotificationsAsRead);

/**
 * DELETE /api/transactions/notifications/:notificationId
 * Supprimer une notification
 * 
 * Paramètres :
 * - notificationId: ID de la notification
 * 
 * Sécurité : Vérifie que la notification appartient à l'utilisateur
 */
router.delete('/notifications/:notificationId', RecentTransactionController.deleteNotification);

// =====================================
// VÉRIFICATION DE SOLDE
// =====================================

/**
 * GET /api/transactions/balance/:supervisorId/:accountType
 * Vérifier le solde d'un compte avant transaction
 * 
 * Paramètres :
 * - supervisorId: ID du superviseur
 * - accountType: Type de compte (LIQUIDE, ORANGE_MONEY, WAVE, UV_MASTER)
 * - amount: Montant à vérifier (optionnel, query parameter)
 * 
 * Accès : ADMIN ou le superviseur lui-même
 * 
 * Retourne :
 * - exists: Si le compte existe
 * - sufficient: Si le solde est suffisant (si amount fourni)
 * - currentBalance: Solde actuel
 * - requested: Montant demandé
 * - difference: Différence (si amount fourni)
 */
router.get('/balance/:supervisorId/:accountType', RecentTransactionController.checkAccountBalance);

// =====================================
// GESTION DES ERREURS ET MIDDLEWARES
// =====================================

/**
 * Middleware de gestion des erreurs 404 pour cette route
 */
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} non trouvée`,
    availableRoutes: [
      'GET /',
      'GET /paginated',
      'GET /stats',
      'GET /users/all',
      'GET /search',
      'GET /export',
      'GET /export/csv',
      'GET /notifications',
      'PUT /notifications/:id/read',
      'PUT /notifications/read-all',
      'DELETE /notifications/:id',
      'GET /balance/:supervisorId/:accountType'
    ]
  });
});

/**
 * Middleware de gestion des erreurs générales
 */
router.use((error, req, res, next) => {
  console.error('Erreur dans recentTransactionRoutes:', error);
  
  res.status(500).json({
    success: false,
    message: 'Erreur interne du serveur',
    error: process.env.NODE_ENV === 'development' ? error.message : 'Une erreur est survenue'
  });
});

export default router;