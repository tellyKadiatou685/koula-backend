// src/services/NotificationService.js
import prisma from '../config/database.js';

class NotificationService {

  // ══════════════════════════════════════════════════════════════════════════
  // CRÉATION
  // ══════════════════════════════════════════════════════════════════════════

  async createNotification({ userId, title, message, type, data = null }) {
    try {
      if (!userId || !title || !message || !type) {
        console.warn('⚠️ [NOTIF] Données manquantes:', { userId, title, type });
        return null;
      }

      // Vérifier que l'utilisateur existe
      const userExists = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true }
      });
      if (!userExists) {
        console.warn(`⚠️ [NOTIF] Utilisateur introuvable: ${userId}`);
        return null;
      }

      const notification = await prisma.notification.create({
        data: {
          userId,
          title,
          message,
          type,
          isRead: false,
          data: data ? data : undefined
        }
      });

      return notification;

    } catch (error) {
      console.error('❌ [NOTIF] Erreur création:', error.message);
      return null; // Non-bloquant
    }
  }

  // Créer pour plusieurs utilisateurs en une fois
  async createBulkNotifications(notifications) {
    const results = await Promise.allSettled(
      notifications.map(n => this.createNotification(n))
    );
    const successful = results.filter(r => r.status === 'fulfilled' && r.value).length;
    const failed = results.filter(r => r.status === 'rejected' || !r.value).length;
    console.log(`✅ [NOTIF BULK] ${successful} créées, ${failed} échecs`);
    return { successful, failed, total: notifications.length };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LECTURE
  // ══════════════════════════════════════════════════════════════════════════

  async getNotifications(userId, options = {}) {
    try {
      const {
        limit = 20,
        page = 1,
        unreadOnly = false,
        type = null
      } = options;

      const skip = (page - 1) * limit;

      const where = { userId };
      if (unreadOnly) where.isRead = false;
      if (type) where.type = type;

      const [notifications, total, unreadCount] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { userId, isRead: false } })
      ]);

      return {
        notifications,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasMore: skip + notifications.length < total
        },
        unreadCount
      };

    } catch (error) {
      console.error('❌ [NOTIF] Erreur lecture:', error.message);
      return { notifications: [], pagination: { total: 0 }, unreadCount: 0 };
    }
  }

  // Compter uniquement les non lues (pour le badge)
  async getUnreadCount(userId) {
    try {
      return await prisma.notification.count({
        where: { userId, isRead: false }
      });
    } catch (error) {
      console.error('❌ [NOTIF] Erreur count non lues:', error.message);
      return 0;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MARQUER COMME LU
  // ══════════════════════════════════════════════════════════════════════════

  // Marquer une notification comme lue
  async markAsRead(notificationId, userId) {
    try {
      const notification = await prisma.notification.findUnique({
        where: { id: notificationId },
        select: { id: true, userId: true, isRead: true }
      });

      if (!notification) throw new Error('Notification introuvable');
      if (notification.userId !== userId) throw new Error('Accès refusé');
      if (notification.isRead) return { alreadyRead: true };

      const updated = await prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true }
      });

      return { success: true, notification: updated };

    } catch (error) {
      console.error('❌ [NOTIF] Erreur markAsRead:', error.message);
      throw error;
    }
  }

  // Marquer toutes comme lues
  async markAllAsRead(userId) {
    try {
      const result = await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true }
      });

      return { success: true, count: result.count };

    } catch (error) {
      console.error('❌ [NOTIF] Erreur markAllAsRead:', error.message);
      throw error;
    }
  }

  // Marquer plusieurs par IDs
  async markManyAsRead(notificationIds, userId) {
    try {
      const result = await prisma.notification.updateMany({
        where: {
          id: { in: notificationIds },
          userId, // Sécurité : uniquement les siennes
          isRead: false
        },
        data: { isRead: true }
      });

      return { success: true, count: result.count };

    } catch (error) {
      console.error('❌ [NOTIF] Erreur markManyAsRead:', error.message);
      throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUPPRESSION
  // ══════════════════════════════════════════════════════════════════════════

  // Supprimer une notification
  async deleteNotification(notificationId, userId) {
    try {
      const notification = await prisma.notification.findUnique({
        where: { id: notificationId },
        select: { id: true, userId: true }
      });

      if (!notification) throw new Error('Notification introuvable');
      if (notification.userId !== userId) throw new Error('Accès refusé');

      await prisma.notification.delete({ where: { id: notificationId } });

      return { success: true };

    } catch (error) {
      console.error('❌ [NOTIF] Erreur deleteNotification:', error.message);
      throw error;
    }
  }

  // Supprimer toutes les notifications d'un utilisateur
  async deleteAllNotifications(userId) {
    try {
      const result = await prisma.notification.deleteMany({ where: { userId } });
      return { success: true, count: result.count };
    } catch (error) {
      console.error('❌ [NOTIF] Erreur deleteAll:', error.message);
      throw error;
    }
  }

  // Supprimer uniquement les notifications lues
  async deleteReadNotifications(userId) {
    try {
      const result = await prisma.notification.deleteMany({
        where: { userId, isRead: true }
      });
      return { success: true, count: result.count };
    } catch (error) {
      console.error('❌ [NOTIF] Erreur deleteRead:', error.message);
      throw error;
    }
  }

  // Supprimer plusieurs par IDs
  async deleteManyNotifications(notificationIds, userId) {
    try {
      const result = await prisma.notification.deleteMany({
        where: {
          id: { in: notificationIds },
          userId // Sécurité
        }
      });
      return { success: true, count: result.count };
    } catch (error) {
      console.error('❌ [NOTIF] Erreur deleteMany:', error.message);
      throw error;
    }
  }

  // Nettoyage automatique : supprimer les notifs > N jours
  async cleanOldNotifications(daysOld = 30) {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysOld);

      const result = await prisma.notification.deleteMany({
        where: {
          createdAt: { lt: cutoff },
          isRead: true // On ne supprime que les lues
        }
      });

      console.log(`🧹 [NOTIF CLEAN] ${result.count} anciennes notifications supprimées`);
      return { success: true, count: result.count };

    } catch (error) {
      console.error('❌ [NOTIF] Erreur cleanOld:', error.message);
      return { success: false, count: 0 };
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS MÉTIER — TRANSACTIONS
  // ══════════════════════════════════════════════════════════════════════════

  async notifyDepotPartenaire({ superviseurId, partenaireNom, montant }) {
    return this.createNotification({
      userId: superviseurId,
      title: '💰 Nouveau dépôt partenaire',
      message: `${partenaireNom} a déposé ${this._fmt(montant)}`,
      type: 'DEPOT_PARTENAIRE'
    });
  }

  async notifyRetraitPartenaire({ superviseurId, partenaireNom, montant }) {
    return this.createNotification({
      userId: superviseurId,
      title: '💸 Retrait partenaire',
      message: `${partenaireNom} a retiré ${this._fmt(montant)}`,
      type: 'RETRAIT_PARTENAIRE'
    });
  }

  async notifyDebutJournee({ superviseurId, typeCompte, montant }) {
    return this.createNotification({
      userId: superviseurId,
      title: '🌅 Solde de début enregistré',
      message: `${typeCompte} — Solde de début : ${this._fmt(montant)}`,
      type: 'DEBUT_JOURNEE'
    });
  }

  async notifyFinJournee({ superviseurId, typeCompte, montant }) {
    return this.createNotification({
      userId: superviseurId,
      title: '🌙 Solde de fin enregistré',
      message: `${typeCompte} — Solde de fin : ${this._fmt(montant)}`,
      type: 'FIN_JOURNEE'
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS MÉTIER — RESET QUOTIDIEN
  // ══════════════════════════════════════════════════════════════════════════

  async notifyResetToSuperviseurs(superviseurs, { archivedCount, cleanedCount }) {
    const now = new Date();
    const heure = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;

    return this.createBulkNotifications(
      superviseurs.map(sup => ({
        userId: sup.id,
        title: '🔄 Dashboard actualisé',
        message: `Reset quotidien effectué à ${heure}. Vos soldes ont été transférés.`,
        type: 'RESET_SUPERVISOR'
      }))
    );
  }

  async notifyResetToAdmins(admins, { archivedCount, cleanedCount, snapshotsCreated = 0 }) {
    return this.createBulkNotifications(
      admins.map(admin => ({
        userId: admin.id,
        title: '✅ Reset quotidien terminé',
        message: `${snapshotsCreated} snapshots créés, ${archivedCount} transactions archivées, ${cleanedCount} nettoyées.`,
        type: 'RESET_ADMIN'
      }))
    );
  }

  async notifyResetToPartenaires(partenaires) {
    return this.createBulkNotifications(
      partenaires.map(p => ({
        userId: p.id,
        title: '🌅 Nouveau jour commencé',
        message: 'Les compteurs ont été remis à zéro. Nouveau cycle disponible.',
        type: 'RESET_PARTNER'
      }))
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS MÉTIER — UTILISATEURS
  // ══════════════════════════════════════════════════════════════════════════

  async notifyCreationUtilisateur({ adminId, nom, role, codeAcces }) {
    return this.createNotification({
      userId: adminId,
      title: '👤 Utilisateur créé',
      message: `${nom} (${role}) a été créé. Code d'accès : ${codeAcces}`,
      type: 'CREATION_UTILISATEUR'
    });
  }

  async notifyDemandeInscription({ adminIds, nom, telephone }) {
    return this.createBulkNotifications(
      adminIds.map(adminId => ({
        userId: adminId,
        title: '📋 Nouvelle demande d\'inscription',
        message: `${nom} (${telephone}) a soumis une demande d'inscription.`,
        type: 'DEMANDE_INSCRIPTION'
      }))
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS MÉTIER — AUDIT
  // ══════════════════════════════════════════════════════════════════════════

  async notifyModificationTransaction({ superviseurId, transactionId, ancienMontant, nouveauMontant, par }) {
    return this.createNotification({
      userId: superviseurId,
      title: '✏️ Transaction modifiée',
      message: `Transaction #${transactionId.slice(-6)} modifiée par ${par} — ${this._fmt(ancienMontant)} → ${this._fmt(nouveauMontant)}`,
      type: 'AUDIT_MODIFICATION'
    });
  }

  async notifySuppressionTransaction({ superviseurId, montant, type, par }) {
    return this.createNotification({
      userId: superviseurId,
      title: '🗑️ Transaction supprimée',
      message: `${type === 'DEPOT' ? 'Dépôt' : 'Retrait'} de ${this._fmt(montant)} supprimé par ${par}`,
      type: 'AUDIT_SUPPRESSION'
    });
  }

  async notifyModificationCompte({ superviseurId, typeCompte, ancienneValeur, nouvelleValeur, par }) {
    return this.createNotification({
      userId: superviseurId,
      title: '✏️ Compte modifié',
      message: `Compte ${typeCompte} modifié par ${par} — ${this._fmt(ancienneValeur)} → ${this._fmt(nouvelleValeur)}`,
      type: 'AUDIT_MODIFICATION'
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPER PRIVÉ
  // ══════════════════════════════════════════════════════════════════════════

  _fmt(montant) {
    return Math.abs(Number(montant)).toLocaleString('fr-FR') + ' F';
  }
}

export default new NotificationService();