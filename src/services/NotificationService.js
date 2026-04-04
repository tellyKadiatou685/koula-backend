// src/services/NotificationService.js
import prisma from '../config/database.js';

class NotificationService {
  async createNotification(notificationData) {
    try {
      const { userId, title, message, type } = notificationData;
      
      // Validation des données requises
      if (!userId || !title || !message) {
        console.warn('Données manquantes pour la notification:', notificationData);
        return null;
      }

      const notification = await prisma.notification.create({
        data: {
          userId,
          title,
          message,
          type: type || 'SYSTEM_INFO',
          isRead: false
        }
      });

      console.log(`✅ Notification créée pour l'utilisateur ${userId}:`, title);
      return notification;

    } catch (error) {
      console.error('❌ Erreur création notification:', error.message);
      // Ne pas faire échouer le processus principal si notification échoue
      return null;
    }
  }

  async getNotifications(userId, options = {}) {
    try {
      const { limit = 10, unreadOnly = false } = options;
      
      let whereCondition = { userId };
      if (unreadOnly) {
        whereCondition.isRead = false;
      }

      const notifications = await prisma.notification.findMany({
        where: whereCondition,
        orderBy: { createdAt: 'desc' },
        take: limit
      });

      return notifications;
    } catch (error) {
      console.error('Erreur récupération notifications:', error);
      return [];
    }
  }

  async markAsRead(notificationId) {
    try {
      return await prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true }
      });
    } catch (error) {
      console.error('Erreur marquage notification lue:', error);
      return null;
    }
  }
}

export default new NotificationService();