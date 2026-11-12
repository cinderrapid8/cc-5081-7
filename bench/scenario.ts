import type { Catalog, EffectRule, ItemDef, SetDef, SkillDef, StatKey } from '../src/domain/types';
import { BASE_STATS, createCatalog, createInventory } from '../src/domain/seed';

export interface ScaleOptions {
  slotCount: number;
  /** 每个槽位可选的物品变体数（变体归属不同套装，用于制造跨阈值切换） */
  variantsPerSlot: number;
  effectsPerItem: number;
  setCount: number;
  tiersPerSet: number;
  statPool: number;
  tagPool: number;
  seed?: number;
}

export interface Generated {
  catalog: Catalog;
  inventory: { uid: string; itemId: string }[];
  slotOptions: Record<string, string[]>;
}

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAT_KEYS: StatKey[] = [
  'hp', 'mp', 'atk', 'def', 'str', 'dex', 'int', 'critChance', 'critDamage',
  'physicalMitigation', 'fireDamage', 'iceDamage', 'lifesteal', 'shield', 'haste',
];

/**
 * 生成可放大到任意装备规模（槽位数 × 每槽变体数）的合成目录。
 * - 每个槽位有 variantsPerSlot 个变体，变体分属不同套装：单槽位切换即可同时改变两个套装的部件数；
 * - 套装档位为 2..tiersPerSet，一个套装横跨大量槽位；
 * - 每件物品有 effectsPerItem 条规则，条件在 always / 属性阈值 / 标签 / 套装档位 之间随机；
 * - 少量规则引用不存在的技能，保证失效引用路径也被覆盖。
 */
export function generateScaleCatalog(opts: ScaleOptions): Generated {
  const rng = makeRng(opts.seed ?? 20261112);
  const statKeys = STAT_KEYS.slice(0, Math.max(1, Math.min(STAT_KEYS.length, opts.statPool)));
  const tags = Array.from({ length: opts.tagPool }, (_, i) => `tag_${i}`);
  const setIds = Array.from({ length: opts.setCount }, (_, i) => `set_${i}`);
  const slots = Array.from({ length: opts.slotCount }, (_, i) => ({ id: `slot_${i}`, name: `槽位 ${i}` }));

  const skills: Record<string, SkillDef> = {};
  for (let i = 0; i < 6; i++) {
    skills[`skill_${i}`] = {
      id: `skill_${i}`,
      name: `技能${i}`,
      description: `合成技能 ${i}`,
      hooks:
        i % 3 === 0
          ? [{ kind: 'damageDealtMultiplier', factor: 1.2, element: 'physical' }]
          : i % 3 === 1
            ? [{ kind: 'damageDealtBonus', amount: 8, element: 'fire' }]
            : [{ kind: 'turnStartShield', amount: 10 }],
    };
  }

  const makeCond = (): EffectRule['condition'] => {
    const roll = rng();
    if (roll < 0.35) return { kind: 'always' };
    if (roll < 0.55)
      return { kind: 'statAtLeast', stat: statKeys[Math.floor(rng() * statKeys.length)], value: Math.floor(rng() * 30) };
    if (roll < 0.7)
      return { kind: 'statAtMost', stat: statKeys[Math.floor(rng() * statKeys.length)], value: Math.floor(rng() * 40) };
    if (roll < 0.85) return { kind: 'hasTag', tag: tags[Math.floor(rng() * tags.length)] };
    const setId = setIds[Math.floor(rng() * setIds.length)];
    return { kind: 'setTierAtLeast', setId, tier: 2 + Math.floor(rng() * Math.max(1, opts.tiersPerSet - 1)) };
  };

  const makeRule = (label: string, idx: number): EffectRule => {
    const cond = makeCond();
    const stats: Record<string, number> = {};
    const picks = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < picks; i++) {
      const k = statKeys[Math.floor(rng() * statKeys.length)];
      stats[k] = (stats[k] ?? 0) + Math.floor(rng() * 8) + 1;
    }
    const rule: EffectRule = { id: `${label}_r${idx}`, condition: cond, stats };
    if (rng() < 0.2) {
      rule.skills = rng() < 0.85 ? [`skill_${Math.floor(rng() * 6)}`] : ['skill_missing'];
    }
    return rule;
  };

  const items: Record<string, ItemDef> = {};
  const inventory: { uid: string; itemId: string }[] = [];
  const slotOptions: Record<string, string[]> = {};

  for (let s = 0; s < opts.slotCount; s++) {
    const slotId = slots[s].id;
    slotOptions[slotId] = [];
    // 每个套装只占据少量连续槽位；槽位内最后一个变体来自相邻套装，
    // 使“单槽位切换”也能同时改变两个套装的部件数（跨套装阈值）
    const ownSetId = setIds[s % opts.setCount];
    const neighborSetId = setIds[(s + 1) % opts.setCount];
    for (let v = 0; v < opts.variantsPerSlot; v++) {
      const idx = s * opts.variantsPerSlot + v;
      const id = `item_${idx}`;
      const setId = v === opts.variantsPerSlot - 1 ? neighborSetId : ownSetId;
      const itemTags = tags.filter(() => rng() < 0.1).slice(0, 2);
      const effects: EffectRule[] = [];
      for (let r = 0; r < opts.effectsPerItem; r++) effects.push(makeRule(id, r));
      items[id] = { id, name: `物品 ${idx}`, slots: [slotId], tags: itemTags, setId, effects };
      const uid = `u-${idx}`;
      inventory.push({ uid, itemId: id });
      slotOptions[slotId].push(uid);
    }
  }

  const sets: Record<string, SetDef> = {};
  for (let s = 0; s < opts.setCount; s++) {
    const tiers = [];
    for (let t = 0; t < opts.tiersPerSet; t++) {
      const threshold = t + 2;
      const effects: EffectRule[] = [];
      const ruleCount = 1 + Math.floor(rng() * 2);
      for (let r = 0; r < ruleCount; r++) {
        const stats: Record<string, number> = {};
        const k = statKeys[Math.floor(rng() * statKeys.length)];
        stats[k] = Math.floor(rng() * 10) + 3;
        effects.push({
          id: `set_${s}_t${threshold}_r${r}`,
          condition: { kind: 'always' },
          stats,
          skills: r === 0 && rng() < 0.3 ? [`skill_${Math.floor(rng() * 6)}`] : undefined,
        });
      }
      tiers.push({ threshold, name: `套装${s} 第${threshold}件`, effects });
    }
    sets[`set_${s}`] = { id: `set_${s}`, name: `套装 ${s}`, tiers };
  }

  return { catalog: { slots, items, sets, skills }, inventory, slotOptions };
}

/** 真实种子目录作为“小规模输入”基准（索引建立成本与退化对照） */
export function smallScenario(): {
  catalog: Catalog;
  inventory: { uid: string; itemId: string }[];
  slotOptions: Record<string, string[]>;
} {
  const catalog = createCatalog();
  const inventory = createInventory();
  const slotOptions: Record<string, string[]> = {};
  for (const inst of inventory) {
    const item = catalog.items[inst.itemId];
    for (const slot of item.slots) (slotOptions[slot] ??= []).push(inst.uid);
  }
  return { catalog, inventory, slotOptions };
}

export const SMALL_BASE_STATS = BASE_STATS;

export function scaledBaseStats(statPool: number): Record<string, number> {
  const keys = STAT_KEYS.slice(0, Math.max(1, Math.min(STAT_KEYS.length, statPool)));
  const out: Record<string, number> = {};
  keys.forEach((k, i) => {
    out[k] = k === 'critDamage' ? 1.5 : 10 + i * 2;
  });
  return out;
}
