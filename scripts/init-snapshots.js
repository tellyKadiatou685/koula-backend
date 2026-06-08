// scripts/resetAllCumulData.js
import prisma from '../src/config/database.js';

async function resetAllCumulData() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('              RESET COMPLET DES DONNÉES CUMUL');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // 1. Compter ce qui va être supprimé
    const snapshotsCount = await prisma.dailySnapshot.count();
    const transactionsCount = await prisma.transaction.count({
      where: { description: { startsWith: '[CUMUL_TOTAL]' } }
    });
    const f2Count = await prisma.systemConfig.count({
      where: { key: { startsWith: 'snapshot_f2_' } }
    });

    console.log('📊 ÉLÉMENTS À SUPPRIMER :');
    console.log(`   - Snapshots: ${snapshotsCount}`);
    console.log(`   - Transactions cumul: ${transactionsCount}`);
    console.log(`   - F2 snapshots: ${f2Count}`);
    console.log('');

    // 2. Demander confirmation
    console.log('⚠️  ATTENTION : Cette action est IRRÉVERSIBLE !');
    console.log('   Tous les snapshots et opérations cumul seront supprimés.\n');
    
    // Attendre 5 secondes pour annulation
    console.log('   Pour annuler, appuyez sur Ctrl+C maintenant...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('   ⏳ Exécution en cours...\n');

    // 3. Supprimer les F2 snapshots
    const deletedF2 = await prisma.systemConfig.deleteMany({
      where: { key: { startsWith: 'snapshot_f2_' } }
    });
    console.log(`✅ Supprimés: ${deletedF2.count} F2 snapshots`);

    // 4. Supprimer les transactions cumul total
    const deletedTransactions = await prisma.transaction.deleteMany({
      where: { description: { startsWith: '[CUMUL_TOTAL]' } }
    });
    console.log(`✅ Supprimés: ${deletedTransactions.count} transactions cumul`);

    // 5. Supprimer tous les snapshots
    const deletedSnapshots = await prisma.dailySnapshot.deleteMany();
    console.log(`✅ Supprimés: ${deletedSnapshots.count} snapshots`);

    // 6. Remettre les comptes à zéro
    const updatedAccounts = await prisma.account.updateMany({
      where: {},
      data: {
        balance: 0,
        initialBalance: 0,
        finSecondaire: 0
      }
    });
    console.log(`✅ Remis à zéro: ${updatedAccounts.count} comptes`);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('                    RESET TERMINÉ');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\n💡 Prochaines étapes :');
    console.log('   1. Les superviseurs doivent saisir leurs soldes initiaux');
    console.log('   2. Les snapshots seront recréés automatiquement chaque jour');
    console.log('   3. Les opérations admin seront à nouveau disponibles\n');

  } catch (error) {
    console.error('❌ Erreur:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Script pour réinitialiser uniquement les opérations admin (garder les snapshots)
async function resetOnlyAdminOperations() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('         RESET DES OPÉRATIONS ADMIN SEULEMENT');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    const deleted = await prisma.transaction.deleteMany({
      where: { description: { startsWith: '[CUMUL_TOTAL]' } }
    });
    
    console.log(`✅ Supprimées: ${deleted.count} opérations admin`);
    console.log('✅ Les snapshots sont conservés');
    
  } catch (error) {
    console.error('❌ Erreur:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Choix : reset complet ou seulement admin
const args = process.argv.slice(2);
if (args.includes('--only-admin')) {
  resetOnlyAdminOperations();
} else {
  resetAllCumulData();
}