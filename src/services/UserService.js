// src/services/UserService.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import NotificationService from './NotificationService.js';

class UserService {

  // =====================================
  // UTILITAIRES
  // =====================================

  generateAccessCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async hashAccessCode(code) {
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
    return await bcrypt.hash(code, saltRounds);
  }

  async verifyAccessCode(code, hash) {
    return await bcrypt.compare(code, hash);
  }

  generateToken(user) {
    return jwt.sign(
      { userId: user.id, telephone: user.telephone, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
  }

  // =====================================
  // AUTHENTIFICATION
  // =====================================

  async login(telephone, accessCode) {
    try {
      const user = await prisma.user.findUnique({ where: { telephone } });

      if (!user) throw new Error('Numéro de téléphone ou code d\'accès incorrect');
      if (user.status !== 'ACTIVE') throw new Error('Votre compte n\'est pas encore activé ou a été suspendu');

      const isValidCode = await this.verifyAccessCode(accessCode, user.code);
      if (!isValidCode) throw new Error('Numéro de téléphone ou code d\'accès incorrect');

      const token = this.generateToken(user);

      await prisma.user.update({ where: { id: user.id }, data: { updatedAt: new Date() } });

      await NotificationService.createNotification({
        userId: user.id,
        title: 'Connexion réussie',
        message: `Bienvenue ${user.nomComplet}`,
        type: 'DEPOT_PARTENAIRE'
      });

      return {
        user: {
          id:         user.id,
          telephone:  user.telephone,
          nomComplet: user.nomComplet,
          role:       user.role,
          adresse:    user.adresse  ?? null,
          photo:      user.photo    ?? null,
          status:     user.status
        },
        token
      };
    } catch (error) {
      throw error;
    }
  }

  // =====================================
  // PROFIL — mise à jour (nom, téléphone, adresse, photo)
  // Le code est intentionnellement exclu
  // =====================================

  async updateProfile(userId, payload) {
    try {
      const { nomComplet, telephone, adresse, photo } = payload;

      const hasField = [nomComplet, telephone, adresse, photo].some(f => f !== undefined);
      if (!hasField) throw new Error('Aucun champ à mettre à jour');

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('Utilisateur introuvable');

      if (telephone && telephone.trim() !== user.telephone) {
        const existing = await prisma.user.findUnique({ where: { telephone: telephone.trim() } });
        if (existing) throw new Error('Ce numéro de téléphone est déjà utilisé');
      }

      if (photo !== undefined && photo !== null && photo.trim().length > 0) {
        const isUrl    = photo.startsWith('http://') || photo.startsWith('https://');
        const isBase64 = photo.startsWith('data:image/');
        if (!isUrl && !isBase64) {
          throw new Error('Format photo invalide (URL https:// ou base64 data:image/...)');
        }
      }

      const updateData = {};
      if (nomComplet !== undefined) updateData.nomComplet = nomComplet.trim();
      if (telephone  !== undefined) updateData.telephone  = telephone.trim();
      if (adresse    !== undefined) updateData.adresse    = adresse?.trim() || null;
      if (photo      !== undefined) updateData.photo      = photo?.trim()   || null;

      const updated = await prisma.user.update({
        where: { id: userId },
        data:  updateData,
        select: {
          id:         true,
          telephone:  true,
          nomComplet: true,
          adresse:    true,
          photo:      true,
          role:       true,
          status:     true,
          updatedAt:  true
        }
      });

      console.log(`✅ [PROFILE] ${updated.nomComplet} a mis à jour son profil`);
      return { user: updated };

    } catch (error) {
      console.error('❌ [PROFILE] Erreur updateProfile:', error.message);
      throw error;
    }
  }

  // =====================================
  // DEMANDES D'INSCRIPTION PARTENAIRES
  // =====================================

  async requestRegistration(telephone, nomComplet, adresse, message = null) {
    try {
      const existingUser = await prisma.user.findUnique({ where: { telephone } });
      if (existingUser) throw new Error('Ce numéro de téléphone est déjà utilisé par un compte existant');

      const existingRequest = await prisma.registrationRequest.findUnique({ where: { telephone } });
      if (existingRequest && existingRequest.status === 'PENDING') {
        throw new Error('Une demande d\'inscription est déjà en cours pour ce numéro');
      }
      if (existingRequest) {
        await prisma.registrationRequest.delete({ where: { telephone } });
      }

      const request = await prisma.registrationRequest.create({
        data: { telephone, nomComplet, adresse: adresse || null, message, status: 'PENDING' }
      });

      const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
      for (const admin of admins) {
        await NotificationService.createNotification({
          userId: admin.id,
          title: 'Nouvelle Demande d\'Inscription',
          message: `${nomComplet} demande à devenir partenaire`,
          type: 'DEMANDE_INSCRIPTION'
        });
      }

      return request;
    } catch (error) {
      throw error;
    }
  }

  async getPendingRegistrations(options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      const skip = (page - 1) * limit;

      const [requests, totalCount] = await Promise.all([
        prisma.registrationRequest.findMany({
          where: { status: 'PENDING' },
          include: { reviewedBy: { select: { nomComplet: true } } },
          orderBy: { createdAt: 'desc' },
          skip, take: limit
        }),
        prisma.registrationRequest.count({ where: { status: 'PENDING' } })
      ]);

      return {
        requests,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalItems: totalCount,
          itemsPerPage: limit
        }
      };
    } catch (error) {
      throw new Error('Erreur lors de la récupération des demandes d\'inscription');
    }
  }

  async approveRegistration(adminId, requestId) {
    try {
      const request = await prisma.registrationRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new Error('Demande d\'inscription introuvable');
      if (request.status !== 'PENDING') throw new Error('Cette demande a déjà été traitée');

      const existingUser = await prisma.user.findUnique({ where: { telephone: request.telephone } });
      if (existingUser) throw new Error('Ce numéro de téléphone est déjà utilisé');

      const accessCode = this.generateAccessCode();
      const hashedCode = await this.hashAccessCode(accessCode);

      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            telephone:  request.telephone,
            nomComplet: request.nomComplet,
            adresse:    request.adresse ?? null,
            code:       hashedCode,
            codeClair:  accessCode,
            role:       'PARTENAIRE',
            status:     'ACTIVE'
          }
        });

        await tx.registrationRequest.update({
          where: { id: requestId },
          data: { status: 'APPROVED', reviewedById: adminId, reviewedAt: new Date(), codeGenere: accessCode }
        });

        return user;
      });

      await NotificationService.createNotification({
        userId: result.id,
        title: 'Inscription Approuvée !',
        message: `Bienvenue ${result.nomComplet} ! Votre code d'accès : ${accessCode}`,
        type: 'CREATION_UTILISATEUR'
      });

      return { user: result, codeAcces: accessCode };
    } catch (error) {
      throw error;
    }
  }

  async rejectRegistration(adminId, requestId, reason) {
    try {
      const request = await prisma.registrationRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new Error('Demande d\'inscription introuvable');
      if (request.status !== 'PENDING') throw new Error('Cette demande a déjà été traitée');

      const updated = await prisma.registrationRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED', reviewedById: adminId, reviewedAt: new Date() }
      });

      return { request: updated, reason };
    } catch (error) {
      throw error;
    }
  }

  // =====================================
  // GESTION UTILISATEURS (Admin)
  // =====================================

  async createUser(userData) {
    try {
      const accessCode = (userData.code && userData.code.trim().length >= 4)
        ? userData.code.trim()
        : this.generateAccessCode();

      const hashedAccessCode = await this.hashAccessCode(accessCode);

      const { code: _ignored, adresse: rawAdresse, photo: rawPhoto, ...rest } = userData;

      const user = await prisma.user.create({
        data: {
          ...rest,
          adresse:   rawAdresse?.trim() || null,
          photo:     rawPhoto?.trim()   || null,
          code:      hashedAccessCode,
          codeClair: accessCode,
          status:    'ACTIVE'
        }
      });

      await NotificationService.createNotification({
        userId:  user.id,
        title:   'Compte Créé !',
        message: `Votre compte ${user.role.toLowerCase()} a été créé. Code : ${accessCode}`,
        type:    'CREATION_UTILISATEUR'
      });

      return {
        user: {
          id:         user.id,
          telephone:  user.telephone,
          nomComplet: user.nomComplet,
          adresse:    user.adresse  ?? null,
          photo:      user.photo    ?? null,
          role:       user.role,
          status:     user.status,
          createdAt:  user.createdAt
        },
        codeAcces:    accessCode,
        codeSource:   (userData.code?.trim().length >= 4) ? 'custom' : 'generated',
        notification: `${user.nomComplet} peut se connecter avec le code : ${accessCode}`
      };
    } catch (error) {
      if (error.code === 'P2002') throw new Error('Ce numéro de téléphone est déjà utilisé');
      throw new Error(`Erreur création utilisateur : ${error.message}`);
    }
  }

  // =====================================
  // MODIFICATION UTILISATEUR (Admin)
  // Champs modifiables : nomComplet, telephone, adresse, photo, role, status
  // Code : optionnel — si fourni (≥ 4 chars) il est rehasché
  // =====================================

  async updateUser(adminId, userId, payload) {
    try {
      const { nomComplet, telephone, adresse, photo, role, status, code } = payload;

      const hasField = [nomComplet, telephone, adresse, photo, role, status, code]
        .some(f => f !== undefined);
      if (!hasField) throw new Error('Aucun champ à mettre à jour');

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('Utilisateur introuvable');
      if (user.role === 'ADMIN') throw new Error('Impossible de modifier un administrateur');
      if (userId === adminId) throw new Error('Utilisez /profile pour modifier votre propre compte');

      // Vérifier unicité du téléphone si changé
      if (telephone && telephone.trim() !== user.telephone) {
        const existing = await prisma.user.findUnique({ where: { telephone: telephone.trim() } });
        if (existing) throw new Error('Ce numéro de téléphone est déjà utilisé');
      }

      // Valider le rôle si fourni
      const rolesValides = ['SUPERVISEUR', 'PARTENAIRE'];
      if (role !== undefined && !rolesValides.includes(role)) {
        throw new Error(`Rôle invalide. Valeurs acceptées : ${rolesValides.join(', ')}`);
      }

      // Valider le statut si fourni
      const statusValides = ['ACTIVE', 'SUSPENDED'];
      if (status !== undefined && !statusValides.includes(status)) {
        throw new Error(`Statut invalide. Valeurs acceptées : ${statusValides.join(', ')}`);
      }

      // Valider la photo si fournie
      if (photo !== undefined && photo !== null && photo.trim().length > 0) {
        const isUrl    = photo.startsWith('http://') || photo.startsWith('https://');
        const isBase64 = photo.startsWith('data:image/');
        if (!isUrl && !isBase64) {
          throw new Error('Format photo invalide (URL https:// ou base64 data:image/...)');
        }
      }

      // Construire les champs à mettre à jour
      const updateData = {};
      if (nomComplet !== undefined) updateData.nomComplet = nomComplet.trim();
      if (telephone  !== undefined) updateData.telephone  = telephone.trim();
      if (adresse    !== undefined) updateData.adresse    = adresse?.trim()  || null;
      if (photo      !== undefined) updateData.photo      = photo?.trim()    || null;
      if (role       !== undefined) updateData.role       = role;
      if (status     !== undefined) updateData.status     = status;

      // Code : rehacher si fourni et valide
      let newCodeClair = null;
      if (code !== undefined && code !== null && code.trim().length >= 4) {
        const hashedCode       = await this.hashAccessCode(code.trim());
        updateData.code        = hashedCode;
        updateData.codeClair   = code.trim();
        newCodeClair           = code.trim();
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data:  updateData,
        select: {
          id:         true,
          telephone:  true,
          nomComplet: true,
          adresse:    true,
          photo:      true,
          role:       true,
          status:     true,
          updatedAt:  true
        }
      });

      // Notifier l'utilisateur des changements importants
      const changements = [];
      if (nomComplet) changements.push('nom');
      if (telephone)  changements.push('téléphone');
      if (role)       changements.push('rôle');
      if (status)     changements.push('statut');
      if (newCodeClair) changements.push('code d\'accès');

      if (changements.length > 0) {
        const messageNotif = newCodeClair
          ? `Votre compte a été mis à jour (${changements.join(', ')}). Nouveau code : ${newCodeClair}`
          : `Votre compte a été mis à jour (${changements.join(', ')})`;

        await NotificationService.createNotification({
          userId: userId,
          title:  'Compte mis à jour',
          message: messageNotif,
          type:   'CREATION_UTILISATEUR'
        });
      }

      console.log(`✅ [UPDATE USER] Admin ${adminId} a modifié l'utilisateur ${userId} (${changements.join(', ')})`);

      return {
        user:        updated,
        changements,
        codeModifie: newCodeClair !== null,
        ...(newCodeClair && { nouveauCode: newCodeClair })
      };

    } catch (error) {
      console.error('❌ [UPDATE USER] Erreur:', error.message);
      throw error;
    }
  }

  async getAllUsers(options = {}) {
    try {
      const { role, status, search, page = 1, limit = 20, showCodes = false } = options;
      const skip = (page - 1) * limit;

      let whereCondition = {};
      if (role   && role   !== 'all') whereCondition.role   = role;
      if (status && status !== 'all') whereCondition.status = status;
      if (search) {
        whereCondition.OR = [
          { nomComplet: { contains: search, mode: 'insensitive' } },
          { telephone:  { contains: search } }
        ];
      }

      const selectFields = {
        id: true, telephone: true, nomComplet: true,
        adresse: true, photo: true, role: true,
        status: true, createdAt: true, updatedAt: true
      };
      if (showCodes) selectFields.codeClair = true;

      const [users, totalCount] = await Promise.all([
        prisma.user.findMany({ where: whereCondition, select: selectFields, orderBy: { nomComplet: 'asc' }, skip, take: limit }),
        prisma.user.count({ where: whereCondition })
      ]);

      return {
        users,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalItems: totalCount,
          itemsPerPage: limit
        }
      };
    } catch (error) {
      throw new Error(`Erreur récupération utilisateurs : ${error.message}`);
    }
  }

  async suspendUser(userId, reason = null) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('Utilisateur introuvable');
      if (user.role === 'ADMIN') throw new Error('Impossible de suspendre un administrateur');

      const updatedUser = await prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });

      await NotificationService.createNotification({
        userId: user.id,
        title: 'Compte Suspendu',
        message: `Votre compte a été temporairement suspendu. ${reason || ''}`,
        type: 'CREATION_UTILISATEUR'
      });

      return updatedUser;
    } catch (error) {
      throw error;
    }
  }

  async activateUser(userId) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('Utilisateur introuvable');

      const updatedUser = await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });

      await NotificationService.createNotification({
        userId,
        title: 'Compte Réactivé',
        message: 'Votre compte a été réactivé avec succès',
        type: 'CREATION_UTILISATEUR'
      });

      return updatedUser;
    } catch (error) {
      throw new Error('Erreur lors de la réactivation de l\'utilisateur');
    }
  }

  async deleteUser(adminId, userId, reason = null) {
    try {
      console.log('🗑️ [SERVICE] Début suppression:', { adminId, userId, reason });

      const userToDelete = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          accounts: true,
          transactionsEnvoyees:  { take: 1 },
          transactionsRecues:    { take: 1 },
          transactionsPartenaire:{ take: 1 }
        }
      });

      if (!userToDelete) throw new Error('Utilisateur introuvable');
      if (userToDelete.role === 'ADMIN') throw new Error('Impossible de supprimer un administrateur');
      if (userId === adminId) throw new Error('Vous ne pouvez pas supprimer votre propre compte');

      const hasBalance = userToDelete.accounts.some(a => a.balance > 0 || a.initialBalance > 0);
      if (hasBalance) throw new Error('Impossible de supprimer un utilisateur avec des soldes non nuls');

      const result = await prisma.$transaction(async (tx) => {
        await tx.account.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { userId } });
        return await tx.user.delete({ where: { id: userId } });
      });

      return {
        message: `Utilisateur ${userToDelete.nomComplet} supprimé avec succès`,
        deletedUser: {
          id:         result.id,
          nomComplet: result.nomComplet,
          telephone:  result.telephone,
          role:       result.role
        }
      };
    } catch (error) {
      console.error('❌ [SERVICE] Erreur deleteUser:', error.message);
      throw error;
    }
  }

  // =====================================
  // PARTENAIRES
  // =====================================

  async getPartners(options = {}) {
    try {
      const { status = null, search = null, page = 1, limit = 20, showCodes = false } = options;

      const where = { role: 'PARTENAIRE' };
      if (status && ['ACTIVE', 'SUSPENDED'].includes(status.toUpperCase())) {
        where.status = status.toUpperCase();
      }
      if (search?.trim()) {
        where.OR = [
          { nomComplet: { contains: search.trim(), mode: 'insensitive' } },
          { telephone:  { contains: search.trim() } }
        ];
      }

      const selectFields = {
        id: true, telephone: true, nomComplet: true,
        adresse: true, photo: true, role: true,
        status: true, createdAt: true, updatedAt: true
      };
      if (showCodes) selectFields.codeClair = true;

      const offset = (page - 1) * limit;
      const [partners, totalCount] = await Promise.all([
        prisma.user.findMany({
          where, select: selectFields,
          orderBy: [{ status: 'asc' }, { nomComplet: 'asc' }],
          skip: offset, take: limit
        }),
        prisma.user.count({ where })
      ]);

      const totalPages = Math.ceil(totalCount / limit);
      return {
        partners,
        pagination: {
          currentPage: page, totalPages, totalCount, limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        },
        summary: {
          totalPartners:     totalCount,
          activePartners:    partners.filter(p => p.status === 'ACTIVE').length,
          suspendedPartners: partners.filter(p => p.status === 'SUSPENDED').length
        }
      };
    } catch (error) {
      console.error('Erreur getPartners:', error);
      throw new Error('Erreur lors de la récupération des partenaires');
    }
  }

  // =====================================
  // CODES D'ACCÈS
  // =====================================

  async regenerateAccessCode(userId) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('Utilisateur introuvable');

      const newAccessCode = this.generateAccessCode();
      const hashedCode    = await this.hashAccessCode(newAccessCode);

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data:  { code: hashedCode, codeClair: newAccessCode }
      });

      await NotificationService.createNotification({
        userId,
        title: 'Nouveau Code d\'Accès',
        message: `Votre nouveau code d'accès : ${newAccessCode}`,
        type: 'CREATION_UTILISATEUR'
      });

      return { user: updatedUser, newCode: newAccessCode };
    } catch (error) {
      throw new Error(`Erreur régénération code : ${error.message}`);
    }
  }

  async getUserAccessCode(userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, nomComplet: true, telephone: true, codeClair: true, role: true, status: true }
      });
      if (!user) throw new Error('Utilisateur introuvable');
      return {
        user: { id: user.id, nomComplet: user.nomComplet, telephone: user.telephone, role: user.role, status: user.status },
        codeAcces: user.codeClair
      };
    } catch (error) {
      throw new Error(`Erreur récupération code : ${error.message}`);
    }
  }

  async findUserByAccessCode(accessCode) {
    try {
      const user = await prisma.user.findFirst({
        where: { codeClair: accessCode },
        select: { id: true, telephone: true, nomComplet: true, adresse: true, photo: true, role: true, status: true, codeClair: true, createdAt: true }
      });
      if (!user) throw new Error('Aucun utilisateur trouvé avec ce code');
      return { user };
    } catch (error) {
      throw new Error(`Erreur recherche par code : ${error.message}`);
    }
  }

  async getAccessCodesStats() {
    try {
      const allUsers = await prisma.user.findMany({ select: { role: true, status: true, codeClair: true } });
      return {
        totalUsers:        allUsers.length,
        usersWithCodes:    allUsers.filter(u => u.codeClair).length,
        usersWithoutCodes: allUsers.filter(u => !u.codeClair).length,
        byRole: {
          ADMIN:        allUsers.filter(u => u.role === 'ADMIN').length,
          SUPERVISEUR:  allUsers.filter(u => u.role === 'SUPERVISEUR').length,
          PARTENAIRE:   allUsers.filter(u => u.role === 'PARTENAIRE').length
        },
        byStatus: {
          ACTIVE:    allUsers.filter(u => u.status === 'ACTIVE').length,
          SUSPENDED: allUsers.filter(u => u.status === 'SUSPENDED').length,
          PENDING:   allUsers.filter(u => u.status === 'PENDING').length
        }
      };
    } catch (error) {
      throw new Error(`Erreur calcul statistiques : ${error.message}`);
    }
  }

  // =====================================
  // NOTIFICATIONS
  // =====================================

  async getUserNotifications(userId, options = {}) {
    try {
      const { page = 1, limit = 20, unreadOnly = false } = options;
      const skip = (page - 1) * limit;
      const whereCondition = { userId, ...(unreadOnly && { isRead: false }) };

      const [notifications, totalCount] = await Promise.all([
        prisma.notification.findMany({ where: whereCondition, orderBy: { createdAt: 'desc' }, skip, take: limit }),
        prisma.notification.count({ where: whereCondition })
      ]);

      return {
        notifications,
        pagination: { currentPage: page, totalPages: Math.ceil(totalCount / limit), totalItems: totalCount, itemsPerPage: limit }
      };
    } catch (error) {
      throw new Error('Erreur lors de la récupération des notifications');
    }
  }

  async markNotificationAsRead(notificationId) {
    try {
      const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
      if (!notification) throw new Error('Notification introuvable');
      return await prisma.notification.update({ where: { id: notificationId }, data: { isRead: true } });
    } catch (error) {
      throw new Error('Erreur lors de la mise à jour de la notification');
    }
  }

  async broadcastNotification(adminId, notificationData) {
    try {
      const { title, message, type, targetRole } = notificationData;
      const targetUsers = await prisma.user.findMany({
        where: { role: targetRole, status: 'ACTIVE' },
        select: { id: true, nomComplet: true }
      });
      if (targetUsers.length === 0) throw new Error(`Aucun utilisateur actif avec le rôle ${targetRole}`);

      const notifications = await Promise.all(
        targetUsers.map(user => prisma.notification.create({
          data: { userId: user.id, type, title, message: `${message}\n\nMessage de l'administration` }
        }))
      );

      return { sent: notifications.length, targetRole, recipients: targetUsers.map(u => u.nomComplet) };
    } catch (error) {
      throw new Error(`Erreur lors de la diffusion : ${error.message}`);
    }
  }
}

export default new UserService();