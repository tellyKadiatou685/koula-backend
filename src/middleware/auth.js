// src/middleware/auth.js
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';

// 🔐 Middleware pour vérifier le token JWT
export const authenticateToken = async (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Vous devez être connecté pour accéder à cette ressource'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // CORRIGÉ: Utiliser les bons noms de champs du nouveau schéma
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        telephone: true,    // ✅ CORRIGÉ: phoneNumber → telephone
        nomComplet: true,   // ✅ CORRIGÉ: fullName → nomComplet
        role: true,
        status: true,
        adresse: true       // ✅ CORRIGÉ: address → adresse
      }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur introuvable'
      });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(401).json({
        success: false,
        message: 'Votre compte n\'est pas actif. Contactez l\'administrateur.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('❌ Erreur authentification:', error.message);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({
        success: false,
        message: 'Token invalide. Veuillez vous reconnecter.'
      });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(403).json({
        success: false,
        message: 'Votre session a expiré. Veuillez vous reconnecter.'
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de la vérification de l\'authentification'
      });
    }
  }
};

// Les autres middlewares restent identiques mais avec les bons rôles
export const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Vous n\'avez pas les droits d\'administrateur pour cette action'
    });
  }
  next();
};

export const requireSupervisor = (req, res, next) => {
  if (req.user.role !== 'SUPERVISEUR') {  // ✅ CORRIGÉ: SUPERVISOR → SUPERVISEUR
    return res.status(403).json({
      success: false,
      message: 'Vous devez être superviseur pour accéder à cette ressource'
    });
  }
  next();
};

export const requirePartner = (req, res, next) => {
  if (req.user.role !== 'PARTENAIRE') {  // ✅ CORRIGÉ: PARTNER → PARTENAIRE
    return res.status(403).json({
      success: false,
      message: 'Vous devez être partenaire pour accéder à cette ressource'
    });
  }
  next();
};

export const requireSupervisorOrAdmin = (req, res, next) => {
  if (req.user.role !== 'SUPERVISEUR' && req.user.role !== 'ADMIN') {  // ✅ CORRIGÉ
    return res.status(403).json({
      success: false,
      message: 'Vous devez être superviseur ou administrateur pour cette action'
    });
  }
  next();
};