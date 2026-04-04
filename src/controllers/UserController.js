// src/controllers/UserController.js
import UserService from '../services/UserService.js';

class UserController {

  // =====================================
  // AUTHENTIFICATION
  // =====================================

  async login(req, res) {
    try {
      const { telephone, Code } = req.body;
      const result = await UserService.login(telephone, Code);
      res.json({ success: true, message: `Connexion réussie ! Bienvenue ${result.user.nomComplet}`, data: result });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async logout(req, res) {
    try {
      res.json({ success: true, message: 'Déconnexion réussie. À bientôt !' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur lors de la déconnexion' });
    }
  }

  async getProfile(req, res) {
    try {
      const user = req.user;
      res.json({
        success: true,
        message: 'Profil récupéré avec succès',
        data: {
          user: {
            id:         user.id,
            telephone:  user.telephone,
            nomComplet: user.nomComplet,
            adresse:    user.adresse  ?? null,
            photo:      user.photo    ?? null,
            role:       user.role,
            status:     user.status
          }
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération du profil' });
    }
  }

  async updateProfile(req, res) {
    try {
      const userId = req.user.id;
      const { nomComplet, telephone, adresse, photo } = req.body;

      const hasField = [nomComplet, telephone, adresse, photo].some(f => f !== undefined);
      if (!hasField) {
        return res.status(400).json({
          success: false,
          message: 'Fournissez au moins un champ : nomComplet, telephone, adresse ou photo'
        });
      }

      if (photo !== undefined && photo !== null && photo.trim().length > 0) {
        const isUrl    = photo.startsWith('http://') || photo.startsWith('https://');
        const isBase64 = photo.startsWith('data:image/');
        if (!isUrl && !isBase64) {
          return res.status(400).json({
            success: false,
            message: 'Format photo invalide (URL https:// ou base64 data:image/...)'
          });
        }
      }

      if (nomComplet !== undefined && nomComplet.trim().length < 2) {
        return res.status(400).json({ success: false, message: 'Le nom doit contenir au moins 2 caractères' });
      }

      if (telephone !== undefined && telephone.trim().length < 6) {
        return res.status(400).json({ success: false, message: 'Numéro de téléphone invalide' });
      }

      const result = await UserService.updateProfile(userId, { nomComplet, telephone, adresse, photo });
      res.json({ success: true, message: 'Profil mis à jour avec succès', data: { user: result.user } });

    } catch (error) {
      console.error('❌ Erreur updateProfile:', error.message);
      const status = error.message.includes('introuvable') ? 404
                   : error.message.includes('déjà utilisé') ? 409
                   : 500;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  // =====================================
  // DEMANDES D'INSCRIPTION
  // =====================================

  async requestRegistration(req, res) {
    try {
      const { telephone, nomComplet, adresse, message } = req.body;
      const request = await UserService.requestRegistration(telephone, nomComplet, adresse, message);
      res.status(201).json({
        success: true,
        message: 'Votre demande d\'inscription a été envoyée. L\'administrateur va l\'examiner.',
        data: { id: request.id, telephone: request.telephone, nomComplet: request.nomComplet, status: request.status, createdAt: request.createdAt }
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async getPendingRegistrations(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const result = await UserService.getPendingRegistrations({ page: parseInt(page), limit: parseInt(limit) });
      res.json({ success: true, message: `${result.requests.length} demande(s) en attente`, data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération des demandes' });
    }
  }

  async approveRegistration(req, res) {
    try {
      const { requestId } = req.params;
      const result = await UserService.approveRegistration(req.user.id, requestId);
      res.json({
        success: true,
        message: `Demande approuvée ! Nouveau partenaire : ${result.user.nomComplet}`,
        data: { user: result.user, codeAcces: result.codeAcces }
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async rejectRegistration(req, res) {
    try {
      const { requestId } = req.params;
      const { reason } = req.body;
      const result = await UserService.rejectRegistration(req.user.id, requestId, reason);
      res.json({ success: true, message: 'Demande rejetée', data: result });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  // =====================================
  // GESTION UTILISATEURS (Admin)
  // =====================================

  async createUser(req, res) {
    try {
      const { telephone, nomComplet, role, adresse, photo, code } = req.body;

      if (!telephone || !nomComplet || !role) {
        return res.status(400).json({ success: false, message: 'Données manquantes : telephone, nomComplet et role sont requis' });
      }

      const result = await UserService.createUser({
        telephone, nomComplet, role,
        adresse: adresse || null,
        photo:   photo   || null,
        code:    code    || null,
      });

      res.status(201).json({ success: true, message: `Nouveau ${role.toLowerCase()} créé avec succès !`, data: result });
    } catch (error) {
      console.error('❌ Erreur création utilisateur:', error.message);
      res.status(500).json({
        success: false,
        message: error.message.includes('déjà utilisé') ? 'Ce numéro de téléphone est déjà utilisé' : error.message
      });
    }
  }

  // ✏️ MODIFICATION UTILISATEUR (Admin)
  // PUT /api/users/:userId
  // Body : nomComplet?, telephone?, adresse?, photo?, role?, status?, code?
  async updateUser(req, res) {
    try {
      const { userId } = req.params;
      const adminId    = req.user.id;

      if (!userId) {
        return res.status(400).json({ success: false, message: 'ID utilisateur requis' });
      }

      const { nomComplet, telephone, adresse, photo, role, status, code } = req.body;

      const hasField = [nomComplet, telephone, adresse, photo, role, status, code]
        .some(f => f !== undefined);
      if (!hasField) {
        return res.status(400).json({
          success: false,
          message: 'Fournissez au moins un champ à modifier : nomComplet, telephone, adresse, photo, role, status ou code'
        });
      }

      // Validations basiques avant d'appeler le service
      if (nomComplet !== undefined && nomComplet.trim().length < 2) {
        return res.status(400).json({ success: false, message: 'Le nom doit contenir au moins 2 caractères' });
      }

      if (telephone !== undefined && telephone.trim().length < 6) {
        return res.status(400).json({ success: false, message: 'Numéro de téléphone invalide' });
      }

      if (code !== undefined && code !== null && code.trim().length > 0 && code.trim().length < 4) {
        return res.status(400).json({ success: false, message: 'Le code doit contenir au moins 4 caractères' });
      }

      if (photo !== undefined && photo !== null && photo.trim().length > 0) {
        const isUrl    = photo.startsWith('http://') || photo.startsWith('https://');
        const isBase64 = photo.startsWith('data:image/');
        if (!isUrl && !isBase64) {
          return res.status(400).json({
            success: false,
            message: 'Format photo invalide (URL https:// ou base64 data:image/...)'
          });
        }
      }

      const result = await UserService.updateUser(adminId, userId, {
        nomComplet, telephone, adresse, photo, role, status, code
      });

      res.json({
        success: true,
        message: `Utilisateur ${result.user.nomComplet} mis à jour avec succès`,
        data: result
      });

    } catch (error) {
      console.error('❌ Erreur updateUser:', error.message);
      const status = error.message.includes('introuvable')   ? 404
                   : error.message.includes('Impossible')    ? 403
                   : error.message.includes('déjà utilisé')  ? 409
                   : error.message.includes('invalide')      ? 400
                   : error.message.includes('Utilisez')      ? 400
                   : 500;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  async getAllUsers(req, res) {
    try {
      const { role, status, search, page = 1, limit = 20, showCodes = false } = req.query;
      const isAdmin = req.user?.role === 'ADMIN';

      if (showCodes === 'true' && !isAdmin) {
        return res.status(403).json({ success: false, message: 'Seuls les administrateurs peuvent voir les codes' });
      }

      const result = await UserService.getAllUsers({
        role, status, search,
        page: parseInt(page), limit: parseInt(limit),
        showCodes: isAdmin && showCodes === 'true'
      });

      res.json({ success: true, message: `${result.users.length} utilisateur(s) trouvé(s)`, data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération des utilisateurs' });
    }
  }

  async suspendUser(req, res) {
    try {
      const { userId } = req.params;
      const { reason } = req.body;
      const user = await UserService.suspendUser(userId, reason);
      res.json({ success: true, message: `${user.nomComplet} a été suspendu`, data: user });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async activateUser(req, res) {
    try {
      const { userId } = req.params;
      const user = await UserService.activateUser(userId);
      res.json({ success: true, message: `${user.nomComplet} a été réactivé`, data: user });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async deleteUser(req, res) {
    try {
      const { userId } = req.params;
      const adminId = req.user.id;
      const reason  = req.body.reason || req.query.reason || null;

      if (!userId) return res.status(400).json({ success: false, message: 'ID utilisateur requis' });

      const result = await UserService.deleteUser(adminId, userId, reason);
      res.json({ success: true, message: 'Utilisateur supprimé avec succès', data: result });

    } catch (error) {
      console.error('❌ Erreur suppression:', error.message);
      const status = error.message.includes('introuvable')     ? 404
                   : error.message.includes('Impossible')      ? 403
                   : error.message.includes('soldes non nuls') ? 400
                   : 500;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  // =====================================
  // PARTENAIRES
  // =====================================

  async getPartners(req, res) {
    try {
      const { status, search, page = 1, limit = 20, showCodes = false } = req.query;
      const isAdmin      = req.user.role === 'ADMIN';
      const canShowCodes = isAdmin && showCodes === 'true';

      const result = await UserService.getPartners({
        status, search,
        page: parseInt(page), limit: parseInt(limit),
        showCodes: canShowCodes
      });

      res.json({ success: true, message: `${result.partners.length} partenaire(s) trouvé(s)`, data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // =====================================
  // CODES D'ACCÈS
  // =====================================

  async getUserCode(req, res) {
    try {
      const { userId } = req.params;
      if (req.user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });
      const result = await UserService.getUserAccessCode(userId);
      res.json({ success: true, message: `Code d'accès de ${result.user.nomComplet}`, data: result });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async regenerateUserCode(req, res) {
    try {
      const { userId } = req.params;
      if (req.user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });
      const result = await UserService.regenerateAccessCode(userId);
      res.json({
        success: true,
        message: `Nouveau code généré pour ${result.user.nomComplet}`,
        data: {
          user: { id: result.user.id, nomComplet: result.user.nomComplet, telephone: result.user.telephone, role: result.user.role },
          nouveauCode: result.newCode
        }
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async getCodesStats(req, res) {
    try {
      if (req.user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });
      const stats = await UserService.getAccessCodesStats();
      res.json({ success: true, message: 'Statistiques des codes d\'accès', data: stats });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async findUserByCode(req, res) {
    try {
      const { code } = req.query;
      if (req.user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });
      if (!code) return res.status(400).json({ success: false, message: 'Code d\'accès requis' });
      const result = await UserService.findUserByAccessCode(code);
      res.json({ success: true, message: `Utilisateur trouvé : ${result.user.nomComplet}`, data: result });
    } catch (error) {
      const status = error.message.includes('Aucun') ? 404 : 500;
      res.status(status).json({ success: false, message: error.message });
    }
  }

  // =====================================
  // NOTIFICATIONS
  // =====================================

  async getNotifications(req, res) {
    try {
      const { page = 1, limit = 20, unreadOnly = false } = req.query;
      const result = await UserService.getUserNotifications(req.user.id, {
        page: parseInt(page), limit: parseInt(limit), unreadOnly: unreadOnly === 'true'
      });
      res.json({ success: true, message: `${result.notifications.length} notification(s)`, data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Erreur lors de la récupération des notifications' });
    }
  }

  async markNotificationRead(req, res) {
    try {
      const { notificationId } = req.params;
      const notification = await UserService.markNotificationAsRead(notificationId);
      res.json({ success: true, message: 'Notification marquée comme lue', data: notification });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async broadcastNotification(req, res) {
    try {
      const { title, message, type, targetRole } = req.body;
      if (!title || !message) return res.status(400).json({ success: false, message: 'Titre et message requis' });

      const result = await UserService.broadcastNotification(req.user.id, {
        title, message,
        type:       type       || 'CREATION_UTILISATEUR',
        targetRole: targetRole || 'PARTENAIRE'
      });

      res.status(201).json({ success: true, message: 'Notification diffusée avec succès', data: result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

export default new UserController();