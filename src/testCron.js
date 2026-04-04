import TransactionService from '../src/services/TransactionService.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testCron() {
  console.log("🧪 TEST CRON LOCAL - Démarrage");
  
  try {
    // Affiche la config
    const config = TransactionService.getResetConfig();
    console.log("📋 Configuration:", config);
    
    // Lance le reset
    const result = await TransactionService.forceReset('test-local');
    
    console.log("✅ Résultat:", result);
    
  } catch (error) {
    console.error("❌ Erreur:", error);
  } finally {
    await prisma.$disconnect();
  }
}

testCron();