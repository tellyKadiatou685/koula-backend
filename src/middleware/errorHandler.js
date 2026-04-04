// src/middleware/errorHandler.js - Gestionnaire d'erreurs Prisma sécurisé

export const handlePrismaError = (error, req, res, next) => {
    console.error('🔥 Erreur Prisma détectée:', {
      code: error.code,
      message: error.message,
      meta: error.meta,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
      userId: req.user?.id || 'Non authentifié'
    });
  
    // Mapping des codes d'erreur Prisma vers des messages utilisateur
    const prismaErrorMap = {
      // Erreurs de contrainte de base de données
      'P2002': {
        status: 409,
        userMessage: 'Cette donnée existe déjà dans le système',
        details: 'Conflit de données - valeur déjà utilisée'
      },
      
      // Enregistrement non trouvé
      'P2025': {
        status: 404,
        userMessage: 'Élément non trouvé',
        details: 'L\'enregistrement demandé n\'existe pas'
      },
      
      // Contrainte de clé étrangère
      'P2003': {
        status: 400,
        userMessage: 'Données liées manquantes',
        details: 'Référence vers un élément qui n\'existe pas'
      },
      
      // Violation de contrainte
      'P2004': {
        status: 400,
        userMessage: 'Contrainte de base de données violée',
        details: 'Les données ne respectent pas les règles de la base'
      },
      
      // Connexion à la base de données échouée
      'P1001': {
        status: 503,
        userMessage: 'Service temporairement indisponible',
        details: 'Problème de connexion à la base de données'
      },
      
      // Timeout de la base de données
      'P1008': {
        status: 504,
        userMessage: 'Opération trop longue, veuillez réessayer',
        details: 'Timeout de la base de données'
      },
      
      // Base de données n'existe pas
      'P1003': {
        status: 503,
        userMessage: 'Service indisponible',
        details: 'Configuration de base de données incorrecte'
      },
      
      // Erreur d'authentification DB
      'P1002': {
        status: 503,
        userMessage: 'Service temporairement indisponible',
        details: 'Problème d\'authentification base de données'
      },
      
      // Champ requis manquant
      'P2011': {
        status: 400,
        userMessage: 'Données requises manquantes',
        details: 'Un champ obligatoire n\'est pas fourni'
      },
      
      // Type de données incorrect
      'P2006': {
        status: 400,
        userMessage: 'Format de données incorrect',
        details: 'Le type de donnée fourni est invalide'
      }
    };
  
    // Vérifier si c'est une erreur Prisma
    if (error.code && prismaErrorMap[error.code]) {
      const errorInfo = prismaErrorMap[error.code];
      
      return res.status(errorInfo.status).json({
        success: false,
        message: errorInfo.userMessage,
        error: 'DATABASE_ERROR',
        ...(process.env.NODE_ENV === 'development' && {
          debug: {
            prismaCode: error.code,
            details: errorInfo.details,
            meta: error.meta
          }
        })
      });
    }
  
    // Erreur Prisma générique (code non mappé)
    if (error.name?.includes('Prisma') || error.code?.startsWith('P')) {
      console.error('⚠️ Code Prisma non mappé:', error.code);
      
      return res.status(500).json({
        success: false,
        message: 'Erreur de base de données',
        error: 'DATABASE_ERROR',
        ...(process.env.NODE_ENV === 'development' && {
          debug: {
            prismaCode: error.code,
            rawMessage: error.message
          }
        })
      });
    }
  
    // Pas une erreur Prisma, passer au middleware suivant
    next(error);
  };
  
  // Gestionnaire d'erreurs global amélioré
  export const globalErrorHandler = (err, req, res, next) => {
    console.error('❌ Erreur serveur globale:', {
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      path: req.path,
      method: req.method,
      userId: req.user?.id || 'Non authentifié',
      timestamp: new Date().toISOString()
    });
  
    // Erreur CORS
    if (err.message.includes('CORS') || err.message.includes('Non autorisé par CORS')) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé par la politique CORS',
        error: 'CORS_ERROR'
      });
    }
  
    // Erreur de parsing JSON
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({
        success: false,
        message: 'Format de données invalide',
        error: 'INVALID_JSON'
      });
    }
  
    // Erreur de taille de payload
    if (err.type === 'entity.too.large') {
      return res.status(413).json({
        success: false,
        message: 'Fichier ou données trop volumineux',
        error: 'PAYLOAD_TOO_LARGE'
      });
    }
  
    // Erreur JWT
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Token d\'authentification invalide',
        error: 'INVALID_TOKEN'
      });
    }
  
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expirée, veuillez vous reconnecter',
        error: 'TOKEN_EXPIRED'
      });
    }
  
    // Erreur de validation
    if (err.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Données de validation incorrectes',
        error: 'VALIDATION_ERROR',
        details: err.details || 'Erreur de validation'
      });
    }
  
    // Erreur réseau/connexion
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      return res.status(503).json({
        success: false,
        message: 'Service temporairement indisponible',
        error: 'SERVICE_UNAVAILABLE'
      });
    }
  
    // Erreur générique - ne jamais exposer les détails en production
    res.status(500).json({
      success: false,
      message: 'Une erreur interne s\'est produite',
      error: 'INTERNAL_SERVER_ERROR',
      ...(process.env.NODE_ENV === 'development' && {
        debug: {
          message: err.message,
          stack: err.stack
        }
      })
    });
  };