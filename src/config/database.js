// src/config/database.js
import { PrismaClient } from "@prisma/client";

// Gestion du singleton dans un environnement serverless (Vercel / Neon)
let prisma;

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient({
    errorFormat: "pretty",
    log: ["error"],
  });
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient({
      errorFormat: "pretty",
      log: ["query", "info", "warn", "error"],
    });
  }
  prisma = global.prisma;
}

// Test de connexion complet
async function connectDatabase() {
  try {
    await prisma.$connect();
    console.log("✅ Base de données PostgreSQL (Neon) connectée avec succès");
    console.log("🔗 Prêt pour les notifications automatiques");
  } catch (error) {
    console.error("❌ Erreur de connexion à la base de données:", error);
    console.log("💡 Vérifiez que la base Neon est accessible et que DATABASE_URL est correcte");
  }
}

async function disconnectDatabase() {
  await prisma.$disconnect();
  console.log("🔌 Base de données déconnectée");
}

// ✅ Fonction manquante pour /api/health
async function testConnection() {
  try {
    await prisma.$connect();
    return true;
  } catch (error) {
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

export { prisma, connectDatabase, disconnectDatabase, testConnection };
export default prisma;
