// src/controllers/RecentTransactionController.js
import RecentTransactionService from '../services/RecentTransactionService.js';
import NotificationService from '../services/NotificationService.js';
import prisma from '../config/database.js';

// =====================================
// FONCTIONS UTILITAIRES GLOBALES
// =====================================

const countActiveFilters = (filters) => {
  const filterKeys = ['search', 'supervisorId', 'partnerId', 'operatorId', 'transactionType', 'accountType', 'supervisorName', 'partnerName', 'operatorName', 'userName'];
  return filterKeys.filter(key => filters[key] && filters[key].trim() !== '').length;
};

const getTransactionTypeLabel = (type) => {
  const labels = {
    'DEPOT': 'Dépôt',
    'RETRAIT': 'Retrait',
    'TRANSFERT_ENVOYE': 'Transfert envoyé',
    'TRANSFERT_RECU': 'Transfert reçu',
    'ALLOCATION_UV_MASTER': 'Allocation UV Master',
    'DEBUT_JOURNEE': 'Début journée',
    'FIN_JOURNEE': 'Fin journée'
  };
  
  return labels[type] || type;
};

const getTransactionTypeColor = (type) => {
  const colors = {
    'DEPOT': 'success',
    'RETRAIT': 'warning',
    'TRANSFERT_ENVOYE': 'info',
    'TRANSFERT_RECU': 'success',
    'ALLOCATION_UV_MASTER': 'primary',
    'DEBUT_JOURNEE': 'secondary',
    'FIN_JOURNEE': 'secondary'
  };
  
  return colors[type] || 'default';
};

const getTimeAgo = (date) => {
  const now = new Date();
  const diffInMinutes = Math.floor((now - new Date(date)) / (1000 * 60));
  
  if (diffInMinutes < 1) return 'À l\'instant';
  if (diffInMinutes < 60) return `Il y a ${diffInMinutes} min`;
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `Il y a ${diffInHours}h`;
  
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `Il y a ${diffInDays}j`;
  
  return new Date(date).toLocaleDateString('fr-FR');
};

const getNotificationIcon = (type) => {
  const icons = {
    'DEPOT_PARTENAIRE': '💰',
    'RETRAIT_PARTENAIRE': '💸',
    'TRANSFERT': '🔄',
    'ALLOCATION_UV_MASTER': '⭐',
    'DEBUT_JOURNEE': '🌅',
    'FIN_JOURNEE': '🌆',
    'SYSTEM': '⚙️',
    'WARNING': '⚠️',
    'ERROR': '❌'
  };
  
  return icons[type] || '📝';
};

const getNotificationPriority = (type) => {
  const priorities = {
    'ERROR': 'high',
    'WARNING': 'medium',
    'ALLOCATION_UV_MASTER': 'high',
    'DEPOT_PARTENAIRE': 'medium',
    'RETRAIT_PARTENAIRE': 'medium',
    'TRANSFERT': 'low',
    'DEBUT_JOURNEE': 'low',
    'FIN_JOURNEE': 'low',
    'SYSTEM': 'low'
  };
  
  return priorities[type] || 'low';
};

class RecentTransactionController {

  // =====================================
  // TRANSACTIONS RÉCENTES AVEC FILTRES AVANCÉS
  // =====================================

  async getRecentTransactions(req, res) {
    try {
      const user = req.user;
      
      // Extraction des paramètres de filtrage avancés
    // Dans le contrôleur, remplacez l'extraction des filtres par :
const filters = {
  search: String(req.query.search || ''),
  supervisorId: String(req.query.supervisorId || ''),
  partnerId: String(req.query.partnerId || ''),
  operatorId: String(req.query.operatorId || ''),
  transactionType: req.query.type === 'all' ? '' : String(req.query.type || ''),
  period: String(req.query.period || 'today'),
  // Correction pour accountType : prendre le premier élément si c'est un tableau
  accountType: Array.isArray(req.query.accountType) 
    ? String(req.query.accountType[0] || '') 
    : String(req.query.accountType || ''),
  supervisorName: String(req.query.supervisorName || ''),
  partnerName: String(req.query.partnerName || ''),
  operatorName: String(req.query.operatorName || ''),
  userName: String(req.query.userName || '')
};

      // Paramètres de pagination (par défaut 20, mais peut être changé)
      const pagination = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20,
        sortBy: req.query.sortBy || 'createdAt',
        sortOrder: req.query.sortOrder || 'desc'
      };

      // Validation des paramètres
      if (pagination.page < 1) pagination.page = 1;
      if (pagination.limit < 1 || pagination.limit > 100) pagination.limit = 20;

      // Contrôle d'accès selon le rôle
      switch (user.role) {
        case 'ADMIN':
          break;
        case 'SUPERVISEUR':
          if (!filters.supervisorId) {
            filters.supervisorId = user.id;
          } else if (filters.supervisorId !== user.id) {
            return res.status(403).json({
              success: false,
              message: 'Vous ne pouvez voir que vos propres transactions'
            });
          }
          break;
        case 'PARTENAIRE':
          filters.partnerId = user.id;
          break;
        case 'OPERATEUR':
          filters.operatorId = user.id;
          break;
        default:
          return res.status(403).json({
            success: false,
            message: 'Rôle non autorisé'
          });
      }

      // Récupération des données avec le service
      const result = await RecentTransactionService.getRecentTransactionsWithFilters(filters, pagination);

      res.json({
        success: true,
        message: `${result.pagination.totalCount} transaction(s) récupérée(s)`,
        data: {
          ...result,
          appliedFilters: {
            ...filters,
            activeFiltersCount: countActiveFilters(filters)
          }
        }
      });

    } catch (error) {
      console.error('Erreur getRecentTransactions:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la récupération des transactions'
      });
    }
  }

  // =====================================
  // PAGINATION SPÉCIFIQUE PAR 5
  // =====================================

  async getTransactionsPaginatedByFive(req, res) {
    try {
      const user = req.user;
      const page = parseInt(req.query.page) || 1;

      // Extraction des filtres
      const filters = {
        search: req.query.search || '',
        supervisorId: req.query.supervisorId || '',
        partnerId: req.query.partnerId || '',
        operatorId: req.query.operatorId || '',
        transactionType: req.query.type === 'all' ? '' : (req.query.type || ''),
        period: req.query.period || 'today',
        accountType: req.query.accountType === 'all' ? '' : (req.query.accountType || ''),
        supervisorName: req.query.supervisorName || '',
        partnerName: req.query.partnerName || '',
        operatorName: req.query.operatorName || '',
        userName: req.query.userName || ''
      };

      // Contrôle d'accès selon le rôle
      switch (user.role) {
        case 'ADMIN':
          break;
        case 'SUPERVISEUR':
          if (!filters.supervisorId) {
            filters.supervisorId = user.id;
          } else if (filters.supervisorId !== user.id) {
            return res.status(403).json({
              success: false,
              message: 'Vous ne pouvez voir que vos propres transactions'
            });
          }
          break;
        case 'PARTENAIRE':
          filters.partnerId = user.id;
          break;
        case 'OPERATEUR':
          filters.operatorId = user.id;
          break;
        default:
          return res.status(403).json({
            success: false,
            message: 'Rôle non autorisé'
          });
      }

      // Utilisation du service avec pagination par 5
      const result = await RecentTransactionService.getTransactionsPaginatedByFive(filters, page);

      res.json({
        success: true,
        message: `Page ${page}/${result.pagination.totalPages} - ${result.transactions.length} transaction(s) sur ${result.pagination.totalCount}`,
        data: {
          transactions: result.transactions,
          pagination: {
            currentPage: result.pagination.currentPage,
            totalPages: result.pagination.totalPages,
            totalCount: result.pagination.totalCount,
            limit: 5,
            hasNextPage: result.pagination.hasNextPage,
            hasPrevPage: result.pagination.hasPreviousPage,
            nextPage: result.pagination.hasNextPage ? page + 1 : null,
            prevPage: result.pagination.hasPreviousPage ? page - 1 : null
          },
          stats: result.stats,
          filters: filters
        }
      });

    } catch (error) {
      console.error('Erreur getTransactionsPaginatedByFive:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la récupération des transactions paginées'
      });
    }
  }

  // =====================================
  // RÉCUPÉRER TOUS LES UTILISATEURS
  // =====================================

  async getAllUsers(req, res) {
    try {
      const user = req.user;

      if (!['ADMIN', 'SUPERVISEUR'].includes(user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé'
        });
      }

      const [superviseurs, partenaires, operateurs] = await Promise.all([
        prisma.user.findMany({
          where: { role: 'SUPERVISEUR', status: 'ACTIVE' },
          select: {
            id: true,
            nomComplet: true,
            telephone: true,
            email: true,
            status: true,
            createdAt: true,
            _count: {
              select: {
                transactionsRecues: true,
                transactionsEnvoyees: true,
                accounts: true
              }
            }
          },
          orderBy: { nomComplet: 'asc' }
        }),

        prisma.user.findMany({
          where: { role: 'PARTENAIRE', status: 'ACTIVE' },
          select: {
            id: true,
            nomComplet: true,
            telephone: true,
            email: true,
            status: true,
            createdAt: true,
            _count: {
              select: {
                transactionsEnvoyees: true
              }
            }
          },
          orderBy: { nomComplet: 'asc' }
        }),

        prisma.user.findMany({
          where: { role: 'OPERATEUR', status: 'ACTIVE' },
          select: {
            id: true,
            nomComplet: true,
            telephone: true,
            email: true,
            status: true,
            createdAt: true,
            _count: {
              select: {
                transactionsRecues: true,
                transactionsEnvoyees: true
              }
            }
          },
          orderBy: { nomComplet: 'asc' }
        })
      ]);

      const formatUser = (usersList, role) => {
        return usersList.map(u => ({
          id: u.id,
          nom: u.nomComplet,
          telephone: u.telephone,
          email: u.email,
          role: role,
          status: u.status,
          dateCreation: u.createdAt,
          statistiques: {
            totalTransactions: role === 'PARTENAIRE' 
              ? u._count.transactionsEnvoyees 
              : u._count.transactionsRecues + u._count.transactionsEnvoyees,
            nombreComptes: u._count.accounts || 0
          }
        }));
      };

      const allUsers = {
        superviseurs: formatUser(superviseurs, 'SUPERVISEUR'),
        partenaires: formatUser(partenaires, 'PARTENAIRE'),
        operateurs: formatUser(operateurs, 'OPERATEUR'),
        totaux: {
          superviseurs: superviseurs.length,
          partenaires: partenaires.length,
          operateurs: operateurs.length,
          total: superviseurs.length + partenaires.length + operateurs.length
        }
      };

      res.json({
        success: true,
        message: `${allUsers.totaux.total} utilisateur(s) récupéré(s)`,
        data: allUsers
      });

    } catch (error) {
      console.error('Erreur getAllUsers:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la récupération des utilisateurs'
      });
    }
  }

  // =====================================
  // STATISTIQUES RAPIDES
  // =====================================

  async getTransactionStats(req, res) {
    try {
      const user = req.user;
      const { period = 'today' } = req.query;

      const filters = { period };
      
      switch (user.role) {
        case 'ADMIN':
          break;
        case 'SUPERVISEUR':
          filters.supervisorId = user.id;
          break;
        case 'PARTENAIRE':
          filters.partnerId = user.id;
          break;
        case 'OPERATEUR':
          filters.operatorId = user.id;
          break;
        default:
          return res.status(403).json({
            success: false,
            message: 'Rôle non autorisé'
          });
      }

      const { stats } = await RecentTransactionService.getRecentTransactionsWithFilters(
        filters, 
        { limit: 10000 }
      );

      res.json({
        success: true,
        message: 'Statistiques récupérées',
        data: {
          stats,
          period,
          userRole: user.role
        }
      });

    } catch (error) {
      console.error('Erreur getTransactionStats:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des statistiques'
      });
    }
  }

  // =====================================
  // EXPORT
  // =====================================

  async exportTransactions(req, res) {
    try {
      const user = req.user;

      if (!['ADMIN', 'SUPERVISEUR'].includes(user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Export réservé aux administrateurs et superviseurs'
        });
      }

      const filters = {
        search: req.query.search || '',
        supervisorId: req.query.supervisorId || '',
        partnerId: req.query.partnerId || '',
        operatorId: req.query.operatorId || '',
        transactionType: req.query.type || '',
        period: req.query.period || 'today',
        accountType: req.query.accountType || '',
        supervisorName: req.query.supervisorName || '',
        partnerName: req.query.partnerName || '',
        operatorName: req.query.operatorName || '',
        userName: req.query.userName || ''
      };

      if (user.role === 'SUPERVISEUR') {
        filters.supervisorId = user.id;
      }

      const exportResult = await RecentTransactionService.exportTransactionsToExcel(filters, user.role);

      if (!exportResult.success) {
        return res.status(500).json({
          success: false,
          message: 'Erreur lors de la génération de l\'export'
        });
      }

      const { data, metadata } = exportResult;

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${metadata.nomFichier}"`);
      
      res.json({
        success: true,
        message: 'Export généré avec succès',
        data: {
          transactions: data,
          metadata: metadata,
          downloadInstructions: {
            format: 'JSON',
            filename: metadata.nomFichier,
            records: data.length
          }
        }
      });

    } catch (error) {
      console.error('Erreur exportTransactions:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de l\'export des transactions'
      });
    }
  }

  async exportTransactionsCSV(req, res) {
    try {
      const user = req.user;

      if (!['ADMIN', 'SUPERVISEUR'].includes(user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Export réservé aux administrateurs et superviseurs'
        });
      }

      const filters = {
        period: req.query.period || 'today',
        supervisorId: user.role === 'SUPERVISEUR' ? user.id : req.query.supervisorId,
        transactionType: req.query.type || '',
        search: req.query.search || ''
      };

      const result = await RecentTransactionService.getRecentTransactionsWithFilters(
        filters, 
        { limit: 5000 }
      );

      const csvHeaders = [
        'Date et Heure',
        'Intervenant', 
        'Type',
        'Montant (F CFA)',
        'Compte',
        'Superviseur',
        'Statut'
      ];

      const csvRows = result.transactions.map(tx => [
        tx.dateHeure,
        tx.intervenant.nom,
        tx.type.label,
        tx.montant.valeur.toLocaleString('fr-FR'),
        tx.compte,
        tx.superviseur.nom || tx.superviseur,
        tx.statut.replace(/[✅⏳]/g, '').trim()
      ]);

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      const filename = `transactions_${new Date().toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', Buffer.byteLength(csvContent, 'utf8'));

      res.send(csvContent);

    } catch (error) {
      console.error('Erreur exportTransactionsCSV:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'export CSV'
      });
    }
  }

  // =====================================
  // NOTIFICATIONS
  // =====================================

  async getNotifications(req, res) {
    try {
      const user = req.user;
      const { limit = 10, unreadOnly = false } = req.query;

      const whereCondition = { userId: user.id };
      if (unreadOnly === 'true') {
        whereCondition.isRead = false;
      }

      const notifications = await prisma.notification.findMany({
        where: whereCondition,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit)
      });

      const unreadCount = await prisma.notification.count({
        where: {
          userId: user.id,
          isRead: false
        }
      });

      const formattedNotifications = notifications.map(notif => ({
        id: notif.id,
        title: notif.title,
        message: notif.message,
        type: notif.type,
        isRead: notif.isRead,
        createdAt: notif.createdAt,
        timeAgo: getTimeAgo(notif.createdAt),
        icon: getNotificationIcon(notif.type),
        priority: getNotificationPriority(notif.type)
      }));

      res.json({
        success: true,
        message: `${notifications.length} notification(s) récupérée(s)`,
        data: {
          notifications: formattedNotifications,
          unreadCount,
          hasUnread: unreadCount > 0
        }
      });

    } catch (error) {
      console.error('Erreur getNotifications:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la récupération des notifications'
      });
    }
  }

  async markNotificationAsRead(req, res) {
    try {
      const user = req.user;
      const { notificationId } = req.params;

      const notification = await prisma.notification.findFirst({
        where: {
          id: notificationId,
          userId: user.id
        }
      });

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: 'Notification non trouvée'
        });
      }

      await prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true }
      });

      res.json({
        success: true,
        message: 'Notification marquée comme lue'
      });

    } catch (error) {
      console.error('Erreur markNotificationAsRead:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la mise à jour de la notification'
      });
    }
  }

  async markAllNotificationsAsRead(req, res) {
    try {
      const user = req.user;

      const result = await prisma.notification.updateMany({
        where: {
          userId: user.id,
          isRead: false
        },
        data: { isRead: true }
      });

      res.json({
        success: true,
        message: `${result.count} notification(s) marquée(s) comme lue(s)`
      });

    } catch (error) {
      console.error('Erreur markAllNotificationsAsRead:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Erreur lors de la mise à jour des notifications'
      });
    }
  }

  async deleteNotification(req, res) {
    try {
      const user = req.user;
      const { notificationId } = req.params;

      const notification = await prisma.notification.findFirst({
        where: {
          id: notificationId,
          userId: user.id
        }
      });

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: 'Notification non trouvée'
        });
      }

      await prisma.notification.delete({
        where: { id: notificationId }
      });

      res.json({
        success: true,
        message: 'Notification supprimée avec succès'
      });

    } catch (error) {
      console.error('Erreur deleteNotification:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la suppression de la notification'
      });
    }
  }

  // =====================================
  // RECHERCHE
  // =====================================

  async searchEntities(req, res) {
    try {
      const { q, type = 'all', limit = 10 } = req.query;
      
      if (!q || q.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Terme de recherche trop court (minimum 2 caractères)'
        });
      }

      const result = await RecentTransactionService.searchEntities(q, type, limit);

      res.json({
        success: true,
        message: `Recherche effectuée pour "${q}"`,
        data: result
      });

    } catch (error) {
      console.error('Erreur searchEntities:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la recherche'
      });
    }
  }

  // =====================================
  // VÉRIFICATION DE SOLDE
  // =====================================

  async checkAccountBalance(req, res) {
    try {
      const { supervisorId, accountType } = req.params;
      const { amount } = req.query;

      if (req.user.role !== 'ADMIN' && req.user.id !== supervisorId) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé'
        });
      }

      const result = await RecentTransactionService.checkAccountBalance(
        supervisorId, 
        accountType, 
        amount
      );

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('Erreur checkAccountBalance:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la vérification du solde'
      });
    }
  }
}

export default new RecentTransactionController();