// src/services/AccountTypeService.js
import prisma from '../config/database.js';

const FIXED_ACCOUNT_TYPES = [
  'LIQUIDE', 'ORANGE_MONEY', 'WAVE', 'UV_MASTER',
  'FREE_MONEY', 'WESTERN_UNION', 'RIA', 'MONEYGRAM'
];

const FIXED_ACCOUNT_TYPE_LABELS = {
  LIQUIDE:       'Liquide',
  ORANGE_MONEY:  'Orange Money',
  WAVE:          'Wave',
  UV_MASTER:     'UV Master',
  FREE_MONEY:    'Free Money',
  WESTERN_UNION: 'Western Union',
  RIA:           'Ria',
  MONEYGRAM:     'MoneyGram',
};

const DEFAULT_ACTIVE_TYPES = ['LIQUIDE', 'ORANGE_MONEY', 'WAVE', 'UV_MASTER'];

// Clé SystemConfig qui stocke les slots "Autres" dynamiques
// Format JSON : [{ id: "AUTRES_1", label: "Tigo Cash" }, { id: "AUTRES_2", label: "Wari" }]
const CUSTOM_SLOTS_KEY = 'custom_account_slots';

// ─── AUDIT ───────────────────────────────────────────────────────────────────
async function createAuditLog(adminId, description) {
  if (!adminId || typeof adminId !== 'string' || adminId.trim() === '') {
    console.warn(`⚠️  [AUDIT] Ignoré — adminId manquant: "${adminId}"`);
    return;
  }
  try {
    await prisma.transaction.create({
      data: { montant: 0, type: 'AUDIT_MODIFICATION', description, envoyeurId: adminId }
    });
  } catch (err) {
    console.error('⚠️  [AUDIT] Échec:', err.message);
  }
}

// ─── HELPER : lire les slots custom depuis SystemConfig ──────────────────────
async function readCustomSlots() {
  const config = await prisma.systemConfig.findFirst({ where: { key: CUSTOM_SLOTS_KEY } });
  if (!config) return [];
  try {
    return JSON.parse(config.value); // [{ id, label }]
  } catch {
    return [];
  }
}

// ─── HELPER : sauvegarder les slots custom ───────────────────────────────────
async function writeCustomSlots(slots) {
  await prisma.systemConfig.upsert({
    where:  { key: CUSTOM_SLOTS_KEY },
    update: { value: JSON.stringify(slots) },
    create: { key: CUSTOM_SLOTS_KEY, value: JSON.stringify(slots) }
  });
}

// ─── HELPER : générer un ID unique pour un nouveau slot ─────────────────────
function generateSlotId(slots) {
  const nums = slots
    .map(s => parseInt(s.id.replace('AUTRES_', ''), 10))
    .filter(n => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `AUTRES_${next}`;
}

class AccountTypeService {

  // ─── LECTURE PRINCIPALE ────────────────────────────────────────────────────
  async getAccountTypesConfig() {
    try {
      const [typesConfig, customSlots] = await Promise.all([
        prisma.systemConfig.findFirst({ where: { key: 'active_account_types' } }),
        readCustomSlots()
      ]);

      const activeTypes = typesConfig ? JSON.parse(typesConfig.value) : DEFAULT_ACTIVE_TYPES;

      // Types fixes
      const fixedTypes = FIXED_ACCOUNT_TYPES.map(type => ({
        value:             type,
        label:             FIXED_ACCOUNT_TYPE_LABELS[type],
        isActive:          activeTypes.includes(type),
        canCustomizeLabel: false,
        isCustomSlot:      false,
      }));

      // Slots "Autres" dynamiques
      const customTypes = customSlots.map(slot => ({
        value:             slot.id,       // ex: "AUTRES_1"
        label:             slot.label,    // ex: "Tigo Cash"
        isActive:          activeTypes.includes(slot.id),
        canCustomizeLabel: true,
        isCustomSlot:      true,
      }));

      const allTypes = [...fixedTypes, ...customTypes];

      const activeOptions = allTypes
        .filter(t => t.isActive)
        .map(t => ({ value: t.value, label: t.label }));

      return { allTypes, activeTypes, activeOptions, customSlots };

    } catch (error) {
      console.error('❌ [ACCOUNT TYPE] getAccountTypesConfig:', error);
      const fallback = DEFAULT_ACTIVE_TYPES.map(t => ({
        value: t, label: FIXED_ACCOUNT_TYPE_LABELS[t]
      }));
      return {
        allTypes:      FIXED_ACCOUNT_TYPES.map(t => ({
          value: t, label: FIXED_ACCOUNT_TYPE_LABELS[t],
          isActive: DEFAULT_ACTIVE_TYPES.includes(t),
          canCustomizeLabel: false, isCustomSlot: false
        })),
        activeTypes:   DEFAULT_ACTIVE_TYPES,
        activeOptions: fallback,
        customSlots:   []
      };
    }
  }

  // ─── AJOUTER UN NOUVEAU SLOT "AUTRES" ─────────────────────────────────────
  async addCustomSlot(adminId, label) {
    const trimmed = label?.trim();
    if (!trimmed || trimmed.length < 2)  throw new Error('Le nom doit contenir au moins 2 caractères');
    if (trimmed.length > 50)             throw new Error('Le nom ne peut pas dépasser 50 caractères');

    const slots = await readCustomSlots();

    // Vérifier doublon de label
    if (slots.some(s => s.label.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`Un type "${trimmed}" existe déjà`);
    }

    const newId = generateSlotId(slots);
    const newSlots = [...slots, { id: newId, label: trimmed }];
    await writeCustomSlots(newSlots);

    // Activer automatiquement le nouveau slot
    const typesConfig = await prisma.systemConfig.findFirst({ where: { key: 'active_account_types' } });
    const activeTypes = typesConfig ? JSON.parse(typesConfig.value) : DEFAULT_ACTIVE_TYPES;
    const newActive = [...activeTypes, newId];
    await prisma.systemConfig.upsert({
      where:  { key: 'active_account_types' },
      update: { value: JSON.stringify(newActive) },
      create: { key: 'active_account_types', value: JSON.stringify(newActive) }
    });

    await createAuditLog(adminId, `Nouveau type personnalisé ajouté: "${trimmed}" (${newId})`);
    console.log(`✅ [ACCOUNT TYPE] Slot ajouté: ${newId} → "${trimmed}"`);

    return { success: true, slot: { id: newId, label: trimmed }, activeTypes: newActive };
  }

  // ─── RENOMMER UN SLOT "AUTRES" ────────────────────────────────────────────
  // ✅ FIX BUG : stockage par ID, pas de confusion avec l'ancien "autres_label"
  async renameCustomSlot(adminId, slotId, newLabel) {
    const trimmed = newLabel?.trim();
    if (!trimmed || trimmed.length < 2)  throw new Error('Le nom doit contenir au moins 2 caractères');
    if (trimmed.length > 50)             throw new Error('Le nom ne peut pas dépasser 50 caractères');

    const slots = await readCustomSlots();
    const idx = slots.findIndex(s => s.id === slotId);
    if (idx === -1) throw new Error(`Slot introuvable: ${slotId}`);

    // Vérifier doublon (sauf soi-même)
    if (slots.some((s, i) => i !== idx && s.label.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`Un autre type "${trimmed}" existe déjà`);
    }

    const oldLabel = slots[idx].label;
    slots[idx] = { ...slots[idx], label: trimmed };
    await writeCustomSlots(slots);

    await createAuditLog(adminId, `Type "${oldLabel}" (${slotId}) renommé en "${trimmed}"`);
    console.log(`✅ [ACCOUNT TYPE] ${slotId}: "${oldLabel}" → "${trimmed}"`);

    return { success: true, slot: { id: slotId, label: trimmed } };
  }

  // ─── SUPPRIMER UN SLOT "AUTRES" ───────────────────────────────────────────
  async removeCustomSlot(adminId, slotId) {
    const slots = await readCustomSlots();
    const slot = slots.find(s => s.id === slotId);
    if (!slot) throw new Error(`Slot introuvable: ${slotId}`);

    const newSlots = slots.filter(s => s.id !== slotId);
    await writeCustomSlots(newSlots);

    // Retirer de active_account_types
    const typesConfig = await prisma.systemConfig.findFirst({ where: { key: 'active_account_types' } });
    const activeTypes = typesConfig ? JSON.parse(typesConfig.value) : [];
    const newActive = activeTypes.filter(t => t !== slotId);
    await prisma.systemConfig.upsert({
      where:  { key: 'active_account_types' },
      update: { value: JSON.stringify(newActive) },
      create: { key: 'active_account_types', value: JSON.stringify(newActive) }
    });

    await createAuditLog(adminId, `Type personnalisé supprimé: "${slot.label}" (${slotId})`);
    console.log(`✅ [ACCOUNT TYPE] Slot supprimé: ${slotId} ("${slot.label}")`);

    return { success: true, slotId, removedLabel: slot.label, activeTypes: newActive };
  }

  // ─── TOGGLE ACTIF/INACTIF ─────────────────────────────────────────────────
  async toggleAccountType(adminId, accountType, isActive) {
    const { allTypes } = await this.getAccountTypesConfig();
    const exists = allTypes.some(t => t.value === accountType);
    if (!exists) throw new Error(`Type de compte invalide: ${accountType}`);

    const typesConfig = await prisma.systemConfig.findFirst({ where: { key: 'active_account_types' } });
    const activeTypes = typesConfig ? JSON.parse(typesConfig.value) : DEFAULT_ACTIVE_TYPES;

    let newTypes;
    if (isActive) {
      newTypes = activeTypes.includes(accountType) ? activeTypes : [...activeTypes, accountType];
    } else {
      newTypes = activeTypes.filter(t => t !== accountType);
      if (newTypes.length === 0) throw new Error('Au moins un type doit rester actif');
    }

    await prisma.systemConfig.upsert({
      where:  { key: 'active_account_types' },
      update: { value: JSON.stringify(newTypes) },
      create: { key: 'active_account_types', value: JSON.stringify(newTypes) }
    });

    await createAuditLog(adminId, `Type "${accountType}" ${isActive ? 'activé' : 'désactivé'}`);

    return { success: true, accountType, isActive, activeTypes: newTypes };
  }

  // ─── HELPERS ───────────────────────────────────────────────────────────────
  async isTypeActive(accountType) {
    try {
      const { activeTypes } = await this.getAccountTypesConfig();
      return activeTypes.includes(accountType);
    } catch {
      return DEFAULT_ACTIVE_TYPES.includes(accountType);
    }
  }

  async getTypeLabel(accountType) {
    if (FIXED_ACCOUNT_TYPE_LABELS[accountType]) return FIXED_ACCOUNT_TYPE_LABELS[accountType];
    // Chercher dans les slots custom
    const slots = await readCustomSlots();
    const slot = slots.find(s => s.id === accountType);
    return slot?.label || accountType;
  }

  getStaticLabel(type) { return FIXED_ACCOUNT_TYPE_LABELS[type] || type; }
  getAllPossibleTypes() { return FIXED_ACCOUNT_TYPES; }

  // ─── LEGACY (ancienne API conservée pour compatibilité) ───────────────────
  async updateAutresLabel(adminId, newLabel) {
    // Redirige vers renameCustomSlot si AUTRES_1 existe, sinon crée un slot
    const slots = await readCustomSlots();
    const legacy = slots.find(s => s.id === 'AUTRES_1') || slots[0];
    if (legacy) return this.renameCustomSlot(adminId, legacy.id, newLabel);
    return this.addCustomSlot(adminId, newLabel);
  }
}

export default new AccountTypeService();