export type StatKey =
  | 'hp'
  | 'mp'
  | 'atk'
  | 'def'
  | 'str'
  | 'dex'
  | 'int'
  | 'critChance'
  | 'critDamage'
  | 'physicalMitigation'
  | 'fireDamage'
  | 'iceDamage'
  | 'lifesteal'
  | 'shield'
  | 'haste';

export type StatMap = Partial<Record<StatKey, number>>;

export type SlotId = string;

export interface SlotDef {
  id: SlotId;
  name: string;
}

export type DamageElement = 'physical' | 'fire' | 'ice';

export type Condition =
  | { kind: 'always' }
  | { kind: 'statAtLeast'; stat: StatKey; value: number }
  | { kind: 'statAtMost'; stat: StatKey; value: number }
  | { kind: 'setTierAtLeast'; setId: string; tier: number }
  | { kind: 'hasTag'; tag: string };

export interface EffectRule {
  id: string;
  condition: Condition;
  stats: StatMap;
  skills?: string[];
}

export interface ItemDef {
  id: string;
  name: string;
  /** 该物品可以放入的槽位 */
  slots: SlotId[];
  /** 互斥标签：任意两件在装物品共享同一标签即冲突 */
  tags: string[];
  setId?: string;
  effects: EffectRule[];
}

export interface ItemInstance {
  uid: string;
  itemId: string;
}

export interface SetTier {
  /** 达到该部件数时激活（累计激活：所有 threshold <= 有效部件数的档位都生效） */
  threshold: number;
  name: string;
  effects: EffectRule[];
}

export interface SetDef {
  id: string;
  name: string;
  /** 同组套装不能同时达到各自的最低档位 */
  mutexGroup?: string;
  tiers: SetTier[];
}

export type SkillHook =
  | { kind: 'damageDealtMultiplier'; factor: number; element?: DamageElement }
  | { kind: 'damageDealtBonus'; amount: number; element?: DamageElement }
  | { kind: 'damageTakenMultiplier'; factor: number; element?: DamageElement }
  | { kind: 'lifestealPercent'; percent: number }
  | { kind: 'turnStartShield'; amount: number };

export interface SkillDef {
  id: string;
  name: string;
  description: string;
  hooks: SkillHook[];
}

export interface Catalog {
  slots: SlotDef[];
  items: Record<string, ItemDef>;
  sets: Record<string, SetDef>;
  skills: Record<string, SkillDef>;
}

export type Loadout = Record<SlotId, string | null>;

export type DiagnosticLevel = 'error' | 'warning';

export interface Diagnostic {
  code: string;
  level: DiagnosticLevel;
  message: string;
  related?: {
    slot?: SlotId;
    uid?: string;
    itemId?: string;
    effectId?: string;
    skillId?: string;
    setId?: string;
    tag?: string;
  };
}

export interface SuppressedItem {
  uid: string;
  itemId: string;
  slot: SlotId;
  reason: 'slot-banned';
}

export type EffectSource =
  | { kind: 'item'; uid: string; itemId: string }
  | { kind: 'set'; setId: string; threshold: number };

export interface EffectTrace {
  ruleId: string;
  source: EffectSource;
  active: boolean;
  /** inactive 时给出未满足的条件，便于界面解释 */
  inactiveReason?: string;
  stats: StatMap;
  skills: string[];
}

export interface DerivedState {
  stats: StatMap;
  skills: string[];
  /** setId -> 当前激活的最高档位 threshold（未激活则不在表中） */
  setTiers: Record<string, number>;
  /** setId -> 有效部件数（被封禁槽位中的部件不计入） */
  setPieceCounts: Record<string, number>;
  suppressed: SuppressedItem[];
  traces: EffectTrace[];
  /** 求值时发现但技能表中不存在的引用（发布校验会把它们定位为错误） */
  unresolvedSkills: { skillId: string; source: EffectSource; ruleId: string }[];
}

export interface ValidationContext {
  catalog: Catalog;
  inventory: ItemInstance[];
  loadout: Loadout;
  bannedSlots: SlotId[];
  alive: boolean;
}
