
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createDefaultAdmin() {
  try {
    console.log('🔧 Création administrateur SBK...');

    const existingAdmin = await prisma.user.findFirst({
      where: { role: 'ADMIN' }
    });

    if (existingAdmin) {
      console.log('❌ Admin existe déjà');
      console.log(`📱 Téléphone: ${existingAdmin.telephone}`);
      console.log(`👤 Nom: ${existingAdmin.nomComplet}`);
      return;
    }

    const code = '111111';
    const hashedCode = await bcrypt.hash(code, 12);

    const admin = await prisma.user.create({
      data: {
        telephone: '770249773',
        nomComplet: 'koula ',
        code: hashedCode,
        role: 'ADMIN',
        status: 'ACTIVE',
        adresse: 'Kolda, Sénégal'
      }
    });

    console.log('✅ Admin créé avec succès !');
    console.log(`📱 Téléphone: ${admin.telephone}`);
    console.log(`🔑 Code: ${code}`);

  } catch (error) {
    console.error('❌ Erreur:', error.message);
    if (error.code === 'P2002') {
      console.log('📱 Numéro déjà utilisé');
    }
  } finally {
    await prisma.$disconnect();
  }
}

createDefaultAdmin();
