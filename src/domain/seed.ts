import type { Catalog, ItemInstance, StatMap } from './types';

export const SLOTS = {
  WEAPON: 'weapon',
  HELM: 'helm',
  CHEST: 'chest',
  GLOVES: 'gloves',
  BOOTS: 'boots',
  ACCESSORY: 'accessory',
} as const;

export const BASE_STATS: StatMap = {
  hp: 200,
  mp: 60,
  atk: 20,
  def: 10,
  str: 12,
  dex: 10,
  int: 10,
  critChance: 0.05,
  critDamage: 1.5,
};

export function createCatalog(): Catalog {
  return {
    slots: [
      { id: SLOTS.WEAPON, name: '武器' },
      { id: SLOTS.HELM, name: '头盔' },
      { id: SLOTS.CHEST, name: '胸甲' },
      { id: SLOTS.GLOVES, name: '护手' },
      { id: SLOTS.BOOTS, name: '战靴' },
      { id: SLOTS.ACCESSORY, name: '饰品' },
    ],
    skills: {
      skill_sword_dance: {
        id: 'skill_sword_dance',
        name: '剑舞斩',
        description: '物理伤害倍率 x1.4',
        hooks: [{ kind: 'damageDealtMultiplier', factor: 1.4, element: 'physical' }],
      },
      skill_flame_burst: {
        id: 'skill_flame_burst',
        name: '烈焰爆裂',
        description: '火焰伤害 +12',
        hooks: [{ kind: 'damageDealtBonus', amount: 12, element: 'fire' }],
      },
      skill_guardian_wall: {
        id: 'skill_guardian_wall',
        name: '守护者壁垒',
        description: '受到的物理伤害 x0.8',
        hooks: [{ kind: 'damageTakenMultiplier', factor: 0.8, element: 'physical' }],
      },
      skill_vampiric_edge: {
        id: 'skill_vampiric_edge',
        name: '吸血锋刃',
        description: '造成伤害的 15% 转为生命',
        hooks: [{ kind: 'lifestealPercent', percent: 15 }],
      },
    },
    items: {
      iron_sword: {
        id: 'iron_sword',
        name: '铁剑',
        slots: [SLOTS.WEAPON],
        tags: ['two-handed'],
        effects: [
          {
            id: 'iron_sword_base',
            condition: { kind: 'always' },
            stats: { atk: 8 },
          },
          {
            id: 'iron_sword_strong',
            condition: { kind: 'statAtLeast', stat: 'str', value: 12 },
            stats: { atk: 6, critChance: 0.05 },
          },
        ],
      },
      flame_staff: {
        id: 'flame_staff',
        name: '烈焰法杖',
        slots: [SLOTS.WEAPON],
        tags: ['two-handed'],
        effects: [
          { id: 'flame_staff_base', condition: { kind: 'always' }, stats: { int: 10, fireDamage: 10 } },
          {
            id: 'flame_staff_skill',
            condition: { kind: 'always' },
            stats: {},
            skills: ['skill_flame_burst'],
          },
        ],
      },
      dagger: {
        id: 'dagger',
        name: '迅捷匕首',
        slots: [SLOTS.WEAPON],
        tags: ['one-handed'],
        effects: [
          { id: 'dagger_base', condition: { kind: 'always' }, stats: { atk: 5, dex: 6, haste: 0.15 } },
        ],
      },
      cursed_grimoire: {
        id: 'cursed_grimoire',
        name: '被诅咒的魔导书（含失效引用）',
        slots: [SLOTS.WEAPON],
        tags: ['cursed'],
        effects: [
          { id: 'grimoire_base', condition: { kind: 'always' }, stats: { int: 8 } },
          {
            // skill_lost_spell 在技能表中不存在：发布校验必须定位并阻断
            id: 'grimoire_broken_ref',
            condition: { kind: 'always' },
            stats: {},
            skills: ['skill_lost_spell'],
          },
        ],
      },
      dragon_helm: {
        id: 'dragon_helm',
        name: '龙鳞头盔',
        slots: [SLOTS.HELM],
        tags: [],
        setId: 'set_dragon',
        effects: [{ id: 'dragon_helm_e', condition: { kind: 'always' }, stats: { hp: 30, def: 4 } }],
      },
      dragon_chest: {
        id: 'dragon_chest',
        name: '龙鳞胸甲',
        slots: [SLOTS.CHEST],
        tags: [],
        setId: 'set_dragon',
        effects: [{ id: 'dragon_chest_e', condition: { kind: 'always' }, stats: { hp: 60, def: 8 } }],
      },
      dragon_gloves: {
        id: 'dragon_gloves',
        name: '龙鳞护手',
        slots: [SLOTS.GLOVES],
        tags: [],
        setId: 'set_dragon',
        effects: [{ id: 'dragon_gloves_e', condition: { kind: 'always' }, stats: { str: 6, atk: 4 } }],
      },
      dragon_boots: {
        id: 'dragon_boots',
        name: '龙鳞战靴',
        slots: [SLOTS.BOOTS],
        tags: [],
        setId: 'set_dragon',
        effects: [{ id: 'dragon_boots_e', condition: { kind: 'always' }, stats: { hp: 20, def: 3 } }],
      },
      frost_helm: {
        id: 'frost_helm',
        name: '霜纹兜帽',
        slots: [SLOTS.HELM],
        tags: [],
        setId: 'set_frost',
        effects: [{ id: 'frost_helm_e', condition: { kind: 'always' }, stats: { mp: 20, int: 4 } }],
      },
      frost_chest: {
        id: 'frost_chest',
        name: '霜纹法袍',
        slots: [SLOTS.CHEST],
        tags: [],
        setId: 'set_frost',
        effects: [{ id: 'frost_chest_e', condition: { kind: 'always' }, stats: { mp: 30, iceDamage: 8 } }],
      },
      frost_gloves: {
        id: 'frost_gloves',
        name: '霜纹手套',
        slots: [SLOTS.GLOVES],
        tags: [],
        setId: 'set_frost',
        effects: [{ id: 'frost_gloves_e', condition: { kind: 'always' }, stats: { int: 6, iceDamage: 4 } }],
      },
      frost_boots: {
        id: 'frost_boots',
        name: '霜纹长靴',
        slots: [SLOTS.BOOTS],
        tags: [],
        setId: 'set_frost',
        effects: [{ id: 'frost_boots_e', condition: { kind: 'always' }, stats: { mp: 15, haste: 0.1 } }],
      },
      power_ring: {
        id: 'power_ring',
        name: '力量之戒',
        slots: [SLOTS.ACCESSORY],
        tags: ['ring'],
        effects: [
          { id: 'power_ring_base', condition: { kind: 'always' }, stats: { str: 4 } },
          {
            id: 'power_ring_dragon',
            condition: { kind: 'setTierAtLeast', setId: 'set_dragon', tier: 2 },
            stats: { atk: 10 },
          },
        ],
      },
      guard_amulet: {
        id: 'guard_amulet',
        name: '守护护符',
        slots: [SLOTS.ACCESSORY],
        tags: ['amulet'],
        effects: [
          { id: 'guard_amulet_base', condition: { kind: 'always' }, stats: { def: 6, shield: 25 } },
          {
            id: 'guard_amulet_skill',
            condition: { kind: 'always' },
            stats: {},
            skills: ['skill_guardian_wall'],
          },
        ],
      },
      vampire_belt: {
        id: 'vampire_belt',
        name: '吸血饰带',
        slots: [SLOTS.ACCESSORY],
        tags: ['belt', 'cursed'],
        effects: [
          {
            id: 'vampire_belt_skill',
            condition: { kind: 'statAtLeast', stat: 'dex', value: 12 },
            stats: { lifesteal: 10 },
            skills: ['skill_vampiric_edge'],
          },
        ],
      },
      dragon_blade: {
        id: 'dragon_blade',
        name: '龙牙之刃',
        slots: [SLOTS.WEAPON],
        tags: ['two-handed', 'dragonforged'],
        setId: 'set_dragon',
        effects: [
          { id: 'dragon_blade_base', condition: { kind: 'always' }, stats: { atk: 14, str: 4 } },
          {
            id: 'dragon_blade_skill',
            condition: { kind: 'hasTag', tag: 'dragonforged' },
            stats: {},
            skills: ['skill_sword_dance'],
          },
        ],
      },
    },
    sets: {
      set_dragon: {
        id: 'set_dragon',
        name: '龙鳞之怒',
        mutexGroup: 'armor-philosophy',
        tiers: [
          {
            threshold: 2,
            name: '2件：龙血',
            effects: [
              { id: 'dragon_t2', condition: { kind: 'always' }, stats: { hp: 50, atk: 5 } },
            ],
          },
          {
            threshold: 3,
            name: '3件：龙威',
            effects: [
              { id: 'dragon_t3', condition: { kind: 'always' }, stats: { str: 8, physicalMitigation: 0.1 } },
            ],
          },
          {
            threshold: 4,
            name: '4件：龙魂',
            effects: [
              {
                id: 'dragon_t4',
                condition: { kind: 'always' },
                stats: { atk: 15, critChance: 0.1 },
                skills: ['skill_sword_dance'],
              },
            ],
          },
        ],
      },
      set_frost: {
        id: 'set_frost',
        name: '霜纹秘术',
        mutexGroup: 'armor-philosophy',
        tiers: [
          {
            threshold: 2,
            name: '2件：寒霜',
            effects: [{ id: 'frost_t2', condition: { kind: 'always' }, stats: { iceDamage: 12, int: 6 } }],
          },
          {
            threshold: 3,
            name: '3件：冰封',
            effects: [{ id: 'frost_t3', condition: { kind: 'always' }, stats: { haste: 0.1, mp: 30 } }],
          },
          {
            threshold: 4,
            name: '4件：霜主',
            effects: [
              {
                id: 'frost_t4',
                condition: { kind: 'always' },
                stats: { iceDamage: 20, critChance: 0.08 },
                skills: ['skill_flame_burst'],
              },
            ],
          },
        ],
      },
    },
  };
}

export function createInventory(): ItemInstance[] {
  const uids: [string, string][] = [
    ['u-sword', 'iron_sword'],
    ['u-staff', 'flame_staff'],
    ['u-dagger', 'dagger'],
    ['u-grimoire', 'cursed_grimoire'],
    ['u-blade', 'dragon_blade'],
    ['u-dhelm', 'dragon_helm'],
    ['u-dchest', 'dragon_chest'],
    ['u-dgloves', 'dragon_gloves'],
    ['u-dboots', 'dragon_boots'],
    ['u-fhelm', 'frost_helm'],
    ['u-fchest', 'frost_chest'],
    ['u-fgloves', 'frost_gloves'],
    ['u-fboots', 'frost_boots'],
    ['u-ring', 'power_ring'],
    ['u-amulet', 'guard_amulet'],
    ['u-belt', 'vampire_belt'],
  ];
  return uids.map(([uid, itemId]) => ({ uid, itemId }));
}

export const DUMMY = {
  name: '训练假人',
  hp: 500,
  def: 5,
  attack: 25,
};
