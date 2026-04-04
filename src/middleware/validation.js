// src/middleware/validation.js
import { body, validationResult } from 'express-validator';

// 📝 Validation pour la demande d'inscription
export const validateRegistration = [
  body('telephone')
    .trim()
    .matches(/^(77|78|70|76|75)\d{7}$/)
    .withMessage('Le numéro doit commencer par 77, 78, 70, 76 ou 75 et contenir 9 chiffres au total (ex: 778025656)'),
  
  body('fullName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Le nom complet doit contenir entre 2 et 100 caractères')
    .matches(/^[a-zA-ZÀ-ÿ\s\-'\.]+$/)
    .withMessage('Le nom ne peut contenir que des lettres, espaces, tirets et apostrophes'),
  
  body('address')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('L\'adresse doit contenir entre 5 et 200 caractères')
];

// 🔐 Validation pour la connexion
export const validateLogin = [
  body('telephone')
    .trim()
    .matches(/^(77|78|70|76|75)\d{7}$/)
    .withMessage('Format de numéro invalide (ex: 778025656)'),
  
  body('Code')
    .isLength({ min: 6, max: 6 })
    .withMessage('Le code d\'accès doit contenir exactement 6 chiffres')
    .isNumeric()
    .withMessage('Le code d\'accès ne peut contenir que des chiffres')
];

// 👥 Validation pour création de compte par admin
export const validateCreateUser = [
  body('telephone')
    .trim()
    .matches(/^(77|78|70|76|75)\d{7}$/)
    .withMessage('Le numéro doit commencer par 77, 78, 70, 76 ou 75 et contenir 9 chiffres (ex: 778025656)'),
  
  body('nomComplet')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Le nom complet doit contenir entre 2 et 100 caractères')
    .matches(/^[a-zA-ZÀ-ÿ\s\-'\.]+$/)
    .withMessage('Le nom ne peut contenir que des lettres, espaces, tirets et apostrophes'),
  
  body('role')
    .isIn(['SUPERVISEUR', 'PARTENAIRE'])
    .withMessage('Le rôle doit être SUPERVISOR (superviseur) ou PARTNER (partenaire)'),
  
  body('address')
    .optional()
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('L\'adresse doit contenir entre 5 et 200 caractères')
];

// 🔔 Validation pour notifications
export const validateNotificationRead = [
  body('notificationId')
    .isString()
    .isLength({ min: 1 })
    .withMessage('ID de notification requis')
];

// ⚠️ Middleware pour gérer les erreurs de validation
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const firstError = errors.array()[0];
    
    return res.status(400).json({
      success: false,
      message: 'Données invalides',
      error: firstError.msg,
      field: firstError.param,
      value: firstError.value
    });
  }
  
  next();
};

// 📱 Validation des numéros sénégalais spécifique
export const validateSenegalPhone = (phoneNumber) => {
  const phoneRegex = /^(77|78|70|76|75)\d{7}$/;
  return phoneRegex.test(phoneNumber);
};

// 🔑 Validation du code d'accès
export const validateAccessCode = (code) => {
  return /^\d{6}$/.test(code);
};