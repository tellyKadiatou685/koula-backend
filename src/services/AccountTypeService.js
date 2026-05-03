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

const DEFAULT_ENTRY_ACCESS = {
  LIQUIDE:       'both',
  ORANGE_MONEY:  'both',
  WAVE:          'both',
  UV_MASTER:     'both',
  FREE_MONEY:    'both',
  WESTERN_UNION: 'fin_only',
  RIA:           'fin_only',
  MONEYGRAM:     'fin_only',
};

const ENTRY_ACCESS_KEY     = 'account_entry_access';
const CUSTOM_SLOTS_KEY     = 'custom_account_slots';
const FEATURED_ACCOUNT_KEY = 'featured_account_type';

const DEFAULT_FEATURED_TYPE = 'UV_MASTER';

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

// ─── HELPERS CUSTOM SLOTS ────────────────────────────────────────────────────
async function readCustomSlots() {
  const config = await prisma.systemConfig.findFirst({ where: { key: CUSTOM_SLOTS_KEY } });
  if (!config) return [];
  try { return JSON.parse(config.value); } catch { return []; }
}

async function writeCustomSlots(slots) {
  await prisma.systemConfig.upsert({
    where:  { key: CUSTOM_SLOTS_KEY },
    update: { value: JSON.stringify(slots) },
    create: { key: CUSTOM_SLOTS_KEY, value: JSON.stringify(slots) }
  });
}

function generateSlotId(slots) {
  const nums = slots
    .map(s => parseInt(s.id.replace('AUTRES_', ''), 10))
    .filter(n => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `AUTRES_${next}`;
}

// ─── HELPERS ENTRY ACCESS ─────────────────────────────────────────────────────
async function readEntryAccess() {
  const config = await prisma.systemConfig.findFirst({ where: { key: ENTRY_ACCESS_KEY } });
  if (!config) return { ...DEFAULT_ENTRY_ACCESS };
  try { return { ...DEFAULT_ENTRY_ACCESS, ...JSON.parse(config.value) }; }
  catch { return { ...DEFAULT_ENTRY_ACCESS }; }
}

async function writeEntryAccess(accessMap) {
  await prisma.systemConfig.upsert({
    where:  { key: ENTRY_ACCESS_KEY },
    update: { value: JSON.stringify(accessMap) },
    create: { key: ENTRY_ACCESS_KEY, value: JSON.stringify(accessMap) }
  });
}

// ─── HELPERS FEATURED TYPE ───────────────────────────────────────────────────
async function readFeaturedType() {
  const config = await prisma.systemConfig.findFirst({ where: { key: FEATURED_ACCOUNT_KEY } });
  if (!config) return DEFAULT_FEATURED_TYPE;
  return config.value || DEFAULT_FEATURED_TYPE;
}

async function writeFeaturedType(type) {
  await prisma.systemConfig.upsert({
    where:  { key: FEATURED_ACCOUNT_KEY },
    update: { value: type },
    create: { key: FEATURED_ACCOUNT_KEY, value: type }
  });
}

class AccountTypeService {

  // ─── LECTURE PRINCIPALE ────────────────────────────────────────────────────
  async getAccountTypesConfig() {
    try {
      const [typesConfig, customSlots, entryAccess, featuredType] = await Promise.all([
        prisma.systemConfig.findFirst({ where: { key: 'active_account_types' } }),
        readCustomSlots(),
        readEntryAccess(),
        readFeaturedType(),
      ]);

      const activeTypes = typesConfig ? JSON.parse(typesConfig.value) : DEFAULT_ACTIVE_TYPES;

      const fixedTypes = FIXED_ACCOUNT_TYPES.map(type => ({
        value:             type,
        label:             FIXED_ACCOUNT_TYPE_LABELS[type],
        isActive:          activeTypes.includes(type),
        canCustomizeLabel: false,
        isCustomSlot:      false,
        entryAccess:       entryAccess[type] || 'both',
        isFeatured:        type === featuredType,
      }));

      const customTypes = customSlots.map(slot => ({
        value:             slot.id,
        label:             slot.label,
        isActive:          activeTypes.includes(slot.id),
        canCustomizeLabel: true,
        isCustomSlot:      true,
        entryAccess:       entryAccess[slot.id] || 'both',
        isFeatured:        slot.id === featuredType,
      }));

      const allTypes      = [...fixedTypes, ...customTypes];
      const activeOptions = allTypes
        .filter(t => t.isActive)
        .map(t => ({ value: t.value, label: t.label, entryAccess: t.entryAccess }));

      return {
        allTypes, activeTypes, activeOptions, customSlots,
        entryAccess,
        featuredType,
      };

    } catch (error) {
      console.error('❌ [ACCOUNT TYPE] getAccountTypesConfig:', error);
      const fallback = DEFAULT_ACTIVE_TYPES.map(t => ({
        value: t, label: FIXED_ACCOUNT_TYPE_LABELS[t], entryAccess: DEFAULT_ENTRY_ACCESS[t] || 'both'
      }));
      return {
        allTypes: FIXED_ACCOUNT_TYPES.map(t => ({
          value: t, label: FIXED_ACCOUNT_TYPE_LABELS[t],
          isActive: DEFAULT_ACTIVE_TYPES.includes(t),
          canCustomizeLabel: false, isCustomSlot: false,
          entryAccess: DEFAULT_ENTRY_ACCESS[t] || 'both',
          isFeatured: t === DEFAULT_FEATURED_TYPE,
        })),
        activeTypes:   DEFAULT_ACTIVE_TYPES,
        activeOptions: fallback,
        customSlots:   [],
        entryAccess:   { ...DEFAULT_ENTRY_ACCESS },
        featuredType:  DEFAULT_FEATURED_TYPE,
      };
    }
  }

  // ─── TYPE VEDETTE ─────────────────────────────────────────────────────────
  async getFeaturedType() {
    try {
      const type = await readFeaturedType();
      const label = await this.getTypeLabel(type);
      return { type, label };
    } catch {
      return { type: DEFAULT_FEATURED_TYPE, label: FIXED_ACCOUNT_TYPE_LABELS[DEFAULT_FEATURED_TYPE] };
    }
  }

  async setFeaturedType(adminId, accountType) {
    const { allTypes } = await this.getAccountTypesConfig();
    const found = allTypes.find(t => t.value === accountType);
    if (!found) {
      throw new Error(`Type de compte inconnu: "${accountType}"`);
    }

    await writeFeaturedType(accountType);

    await createAuditLog(
      adminId,
      `Type vedette défini: "${found.label}" (${accountType})`
    );

    console.log(`✅ [FEATURED] Type vedette → ${accountType} ("${found.label}")`);
    return { featuredType: accountType, label: found.label };
  }

  // ─── MODIFIER L'ACCÈS SAISIE ──────────────────────────────────────────────
  async setEntryAccess(adminId, accountType, access) {
    const validValues = ['both', 'debut_only', 'fin_only'];
    if (!validValues.includes(access)) {
      throw new Error(`Valeur invalide: "${access}". Attendu: ${validValues.join(', ')}`);
    }

    const current = await readEntryAccess();
    current[accountType] = access;
    await writeEntryAccess(current);

    const accessLabels = {
      both:       'début + fin',
      debut_only: 'début uniquement',
      fin_only:   'fin uniquement'
    };

    await createAuditLog(
      adminId,
      `Accès saisie superviseur "${accountType}" → ${accessLabels[access]}`
    );

    console.log(`✅ [ACCOUNT TYPE] Accès saisie ${accountType}: ${access}`);
    return { accountType, access, entryAccess: current };
  }

  // ─── VÉRIFIER ACCÈS SAISIE ────────────────────────────────────────────────
  async canEnterDebut(accountType) {
    try {
      const accessMap = await readEntryAccess();
      const access = accessMap[accountType] || 'both';
      return access === 'both' || access === 'debut_only';
    } catch {
      return !['WESTERN_UNION', 'RIA', 'MONEYGRAM'].includes(accountType);
    }
  }

  async canEnterFin(accountType) {
    try {
      const accessMap = await readEntryAccess();
      const access = accessMap[accountType] || 'both';
      return access === 'both' || access === 'fin_only';
    } catch {
      return true;
    }
  }

  // ─── AJOUTER UN SLOT CUSTOM ───────────────────────────────────────────────
  async addCustomSlot(adminId, label) {
    const trimmed = label?.trim();
    if (!trimmed || trimmed.length < 2) throw new Error('Le nom doit contenir au moins 2 caractères');
    if (trimmed.length > 50)            throw new Error('Le nom ne peut pas dépasser 50 caractères');

    const slots = await readCustomSlots();
    if (slots.some(s => s.label.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`Un type "${trimmed}" existe déjà`);
    }

    const newId    = generateSlotId(slots);
    const newSlots = [...slots, { id: newId, label: trimmed }];
    await writeCustomSlots(newSlots);

    const typesConfig  = await prisma.systemConfig.findFirst({ where: { key: 'active_account_types' } });
    const activeTypes  = typesConfig ? JSON.parse(typesConfig.value) : DEFAULT_ACTIVE_TYPES;
    const newActive    = [...activeTypes, newId];
    await prisma.systemConfig.upsert({
      where:  { key: 'active_account_types' },
      update: { value: JSON.stringify(newActive) },
      create: { key: 'active_account_types', value: JSON.stringify(newActive) }
    });

    const accessMap = await readEntryAccess();
    accessMap[newId] = 'both';
    await writeEntryAccess(accessMap);

    await createAuditLog(adminId, `Nouveau type personnalisé ajouté: "${trimmed}" (${newId})`);
    console.log(`✅ [ACCOUNT TYPE] Slot ajouté: ${newId} → "${trimmed}"`);

    return { slot: { id: newId, label: trimmed }, activeTypes: newActive };
  }

  // ─── RENOMMER UN SLOT CUSTOM ──────────────────────────────────────────────
  async renameCustomSlot(adminId, slotId, newLabel) {
    const trimmed = newLabel?.trim();
    if (!trimmed || trimmed.length < 2) throw new Error('Le nom doit contenir au moins 2 caractères');
    if (trimmed.length > 50)            throw new Error('Le nom ne peut pas dépasser 50 caractères');

    const slots = await readCustomSlots();
    const idx   = slots.findIndex(s => s.id === slotId);
    if (idx === -1) throw new Error(`Slot introuvable: ${slotId}`);

    if (slots.some((s, i) => i !== idx && s.label.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`Un autre type "${trimmed}" existe déjà`);
    }

    const oldLabel = slots[idx].label;
    slots[idx]     = { ...slots[idx], label: trimmed };
    await writeCustomSlots(slots);

    await createAuditLog(adminId, `Type "${oldLabel}" (${slotId}) renommé en "${trimmed}"`);
    console.log(`✅ [ACCOUNT TYPE] ${slotId}: "${oldLabel}" → "${trimmed}"`);

    return { slot: { id: slotId, label: trimmed } };
  }

  // ─── SUPPRIMER UN SLOT CUSTOM ─────────────────────────────────────────────
  async removeCustomSlot(adminId, slotId) {
    const slots = await readCustomSlots();
    const slot  = slots.find(s => s.id === slotId);
    if (!slot) throw new Error(`Slot introuvable: ${slotId}`);

    await writeCustomSlots(slots.filter(s => s.id !== slotId));

    const typesConfig = await prisma.systemConfig.findFirst({ where: { key: 'active_account_types' } });
    const activeTypes = typesConfig ? JSON.parse(typesConfig.value) : [];
    const newActive   = activeTypes.filter(t => t !== slotId);
    await prisma.systemConfig.upsert({
      where:  { key: 'active_account_types' },
      update: { value: JSON.stringify(newActive) },
      create: { key: 'active_account_types', value: JSON.stringify(newActive) }
    });

    const accessMap = await readEntryAccess();
    delete accessMap[slotId];
    await writeEntryAccess(accessMap);

    // Si ce slot était le type vedette, revenir au défaut
    const currentFeatured = await readFeaturedType();
    if (currentFeatured === slotId) {
      await writeFeaturedType(DEFAULT_FEATURED_TYPE);
      console.log(`⚠️  [FEATURED] Slot vedette supprimé → retour à ${DEFAULT_FEATURED_TYPE}`);
    }

    await createAuditLog(adminId, `Type personnalisé supprimé: "${slot.label}" (${slotId})`);
    console.log(`✅ [ACCOUNT TYPE] Slot supprimé: ${slotId} ("${slot.label}")`);

    return { slotId, removedLabel: slot.label, activeTypes: newActive };
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
    return { accountType, isActive, activeTypes: newTypes };
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
    const slots = await readCustomSlots();
    return slots.find(s => s.id === accountType)?.label || accountType;
  }

  getStaticLabel(type) { return FIXED_ACCOUNT_TYPE_LABELS[type] || type; }
  getAllPossibleTypes() { return FIXED_ACCOUNT_TYPES; }

  // ─── LEGACY ───────────────────────────────────────────────────────────────
  async updateAutresLabel(adminId, newLabel) {
    const slots  = await readCustomSlots();
    const legacy = slots.find(s => s.id === 'AUTRES_1') || slots[0];
    if (legacy) return this.renameCustomSlot(adminId, legacy.id, newLabel);
    return this.addCustomSlot(adminId, newLabel);
  }

  async setActiveAccountTypes(adminId, types) {
    await prisma.systemConfig.upsert({
      where:  { key: 'active_account_types' },
      update: { value: JSON.stringify(types) },
      create: { key: 'active_account_types', value: JSON.stringify(types) }
    });
    await createAuditLog(adminId, `Types actifs reconfigurés: ${types.join(', ')}`);
    return { activeTypes: types };
  }
}

export default new AccountTypeService();