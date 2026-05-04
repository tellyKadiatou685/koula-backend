// src/app.js - VERSION CORRIGEE POUR CORS

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

// Import des routes
import userRoutes from './routes/userRoutes.js';
import TransactionRoute from './routes/transactionRoutes.js';
import RecentTransactionRoutes from './routes/recentTransactionRoutes.js';
import AccountLines from './routes/accountLines.js';
import AccountTypes from './routes/accoutTypeRoutes.js';
import cronHandler from '../api/cron.js';
import partner from './routes/partnerBalanceRoutes.js';


const app = express();

// Configuration CORS simplifiée et corrigée
const corsOptions = {
  origin: function (origin, callback) {
    console.log('🔍 Vérification CORS pour origine:', origin);
    console.log('🔍 NODE_ENV:', process.env.NODE_ENV);
    
    const devOrigins = [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:8082',
      'http://localhost:8081',
      
      'http://172.20.10.2:8082'
    ];
    
    const prodOrigins = [
      'https://sayfoulaye.org',
      'https://koula.telly-tech.com',
      'https://fancy-voice-ad1a.kadiatoutelly685.workers.dev',
      'https://koula-backend.vercel.app' ,// ← ajoute aussi ça
       'https://app-tellytech-oair.vercel.app',
       'https://koula.telly-tech.com'
    ];
    
    // Autoriser les requêtes sans origine (Postman, curl, etc.)
    if (!origin) {
      console.log('✅ Requête sans origine autorisée');
      return callback(null, true);
    }
    
    // Toujours inclure les origines de dev ET prod en production
    const allowedOrigins = [...prodOrigins, ...devOrigins];
    
    if (allowedOrigins.includes(origin)) {
      console.log('✅ Origine dans la liste autorisée:', origin);
      return callback(null, true);
    }
    
    // Pattern pour les domaines Vercel dynamiques
    const isVercelDomain = /^https:\/\/sbk-connect-hub-main-[a-z0-9]+\.vercel\.app$/.test(origin);
    
    if (isVercelDomain) {
      console.log('✅ Domaine Vercel autorisé:', origin);
      return callback(null, true);
    }
    
    console.warn('❌ Origine bloquée par CORS:', origin);
    // CORRECTION: Utiliser callback(null, false) au lieu d'une erreur
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  exposedHeaders: ['Set-Cookie'],
  maxAge: 86400,
  optionsSuccessStatus: 200
};

// Appliquer CORS avant tout
app.use(cors(corsOptions));

// Gérer explicitement les requêtes OPTIONS pour toutes les routes
app.options('*', cors(corsOptions));

// Helmet avec configuration adaptée
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting (exclure les requêtes OPTIONS)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 5000 : 10000,
  message: {
    success: false,
    message: 'Limite atteinte. Veuillez patienter quelques minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health' || req.method === 'OPTIONS'
});

app.use('/api/', limiter);

// Middleware de parsing
app.use(express.json({ limit: '10mb', strict: true }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.post('/api/cron/reset', (req, res) => cronHandler(req, res));

// Middleware de logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - Origin: ${req.headers.origin} - IP: ${req.ip}`);
  next();
});

// Route principale
app.get('/', (req, res) => {
  res.json({ 
    message: 'SBK API Server',
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    cors: 'enabled'
  });
});

// Route de debug pour vérifier la configuration
app.get('/api/debug-env', (req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV,
    origin: req.headers.origin,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  });
});

// Route de santé
app.get('/api/health', async (req, res) => {
  try {
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Route de test CORS
app.get('/api/test-cors', (req, res) => {
  res.json({
    message: 'CORS fonctionne !',
    origin: req.headers.origin,
    method: req.method,
    timestamp: new Date().toISOString(),
    headers: {
      'Access-Control-Allow-Origin': res.get('Access-Control-Allow-Origin'),
      'Access-Control-Allow-Methods': res.get('Access-Control-Allow-Methods'),
      'Access-Control-Allow-Headers': res.get('Access-Control-Allow-Headers')
    }
  });
});

// Routes API avec préfixes cohérents
app.use('/api/users', userRoutes);
app.use('/api/transactions', TransactionRoute);
app.use('/api/recent', RecentTransactionRoutes);
app.use('/api/account-lines', AccountLines);
app.use('/api/accountype',  AccountTypes);  
app.use('/api/partner-balance', partner);
 

// Route de test auth
app.get('/api/test-auth', (req, res) => {
  res.json({
    message: 'Route de test accessible',
    headers: req.headers.authorization ? 'Token présent' : 'Pas de token',
    timestamp: new Date().toISOString()
  });
});

// Route 404
app.use('*', (req, res) => {
  console.log(`❌ Route non trouvée: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    message: 'Route non trouvée',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Gestion d'erreurs globale
app.use((err, req, res, next) => {
  console.error('❌ Erreur serveur:', err);
  
  // Erreur CORS
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({
      success: false,
      message: 'Erreur CORS',
      error: 'Origine non autorisée',
      timestamp: new Date().toISOString()
    });
  }
  
  // Erreur de parsing JSON
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      message: 'Format JSON invalide',
      timestamp: new Date().toISOString()
    });
  }
  
  // Erreur générique
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Erreur serveur interne' 
      : err.message,
    timestamp: new Date().toISOString()
  });
});

export default app