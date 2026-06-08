// Script à exécuter UNE SEULE FOIS pour nettoyer les transactions de test
// node cleanup_cumul.js

import prisma from './src/config/database.js';

async function cleanup() {
  // Lister d'abord ce qu'on va supprimer
  const toDelete = await prisma.transaction.findMany({
    where: {
      description: { startsWith: '[CUMUL_TOTAL]' }
    },
    select: { id: true, type: true, montant: true, description: true, createdAt: true },
    orderBy: { createdAt: 'desc' }
  });

  console.log(`\n📋 ${toDelete.length} transactions [CUMUL_TOTAL] trouvées :`);
  toDelete.forEach(tx => {
    const m = Number(tx.montant) / 100;
    console.log(`  ${tx.type} ${m.toLocaleString('fr-FR')} F — ${tx.createdAt.toISOString().split('T')[0]} — ${tx.description.substring(0, 60)}`);
  });

  if (toDelete.length === 0) {
    console.log('Rien à nettoyer.');
    process.exit(0);
  }

  // Suppression physique de TOUTES les transactions [CUMUL_TOTAL] (test)
  const result = await prisma.transaction.deleteMany({
    where: {
      description: { startsWith: '[CUMUL_TOTAL]' }
    }
  });

  console.log(`\n✅ ${result.count} transactions supprimées.`);
  process.exit(0);
}

cleanup().catch(e => {
  console.error('❌ Erreur:', e);
  process.exit(1);
});