import type {
  Catalog,
  DerivedState,
  EffectRule,
  EffectSource,
  EffectTrace,
  Loadout,
  SlotId,
  StatMap,
  SuppressedItem,
} from './types';
import { addStats, evalCondition } from './conditions';

export interface ResolvedEntry {
  slot: SlotId;
  uid: string;
  itemId: string;
  suppressed: boolean;
}

export interface EvalInput {
  catalog: Catalog;
  inventory: { uid: string; itemId: string }[];
  loadout: Loadout;
  bannedSlots: SlotId[];
  baseStats: StatMap;
}

/**
 * 全量重算派生状态，作为增量路径的参照实现。
 * 每次求值都从 (baseStats + 当前负载) 完整重算：不存在“逐件脱装的增量残留”，
 * 来源被移除后其全部效果随重算自然撤销。
 */
export function evaluate(input: EvalInput): DerivedState {
  const { catalog, loadout, bannedSlots } = input;
  const banned = new Set(bannedSlots);

  const uidToItem = new Map(input.inventory.map((i) => [i.uid, i.itemId]));
  const entries: ResolvedEntry[] = [];
  for (const [slot, uid] of Object.entries(loadout)) {
    if (!uid) continue;
    const itemId = uidToItem.get(uid);
    if (!itemId || !catalog.items[itemId]) continue;
    entries.push({ slot, uid, itemId, suppressed: banned.has(slot) });
  }
  return evaluateResolved({ catalog, baseStats: input.baseStats, entries });
}

/**
 * 参照实现的核心：接收已解析的负载条目，避免调用方在批量委托时
 * 重复做 uid→item 映射。evaluate() 与增量路径的批量委托共用这一段求值逻辑，
 * 保证两条路径的条件语义、来源标记与发布顺序完全同源。
 */
export function evaluateResolved(input: {
  catalog: Catalog;
  baseStats: StatMap;
  entries: ResolvedEntry[];
}): DerivedState {
  const { catalog, baseStats, entries } = input;

  const suppressed: SuppressedItem[] = entries
    .filter((e) => e.suppressed)
    .map((e) => ({ uid: e.uid, itemId: e.itemId, slot: e.slot, reason: 'slot-banned' }));

  const activeEntries = entries.filter((e) => !e.suppressed);
  const activeTags = new Set<string>();
  for (const e of activeEntries) {
    for (const tag of catalog.items[e.itemId].tags) activeTags.add(tag);
  }

  // 第一趟：有效部件数与套装分档（封禁槽位部件不计入）
  const pieceCounts: Record<string, number> = {};
  for (const e of activeEntries) {
    const setId = catalog.items[e.itemId].setId;
    if (setId) pieceCounts[setId] = (pieceCounts[setId] ?? 0) + 1;
  }
  const setTiers: Record<string, number> = {};
  for (const [setId, count] of Object.entries(pieceCounts)) {
    const set = catalog.sets[setId];
    if (!set) continue;
    let highest = 0;
    for (const tier of set.tiers) {
      if (count >= tier.threshold) highest = Math.max(highest, tier.threshold);
    }
    if (highest > 0) setTiers[setId] = highest;
  }

  const condCtx = { baseStats, setTiers, activeTags };
  const traces: EffectTrace[] = [];
  const stats: StatMap = {};
  const skillSet = new Set<string>();
  const unresolvedSkills: DerivedState['unresolvedSkills'] = [];

  const runRules = (
    rules: EffectRule[],
    source: EffectSource,
    gate?: () => { allowed: boolean; reason?: string },
  ) => {
    for (const rule of rules) {
      let active = true;
      let inactiveReason: string | undefined;
      if (gate) {
        const g = gate();
        if (!g.allowed) {
          active = false;
          inactiveReason = g.reason;
        }
      }
      if (active) {
        const result = evalCondition(rule.condition, condCtx);
        if (!result.ok) {
          active = false;
          inactiveReason = result.reason;
        }
      }
      const trace: EffectTrace = {
        ruleId: rule.id,
        source,
        active,
        inactiveReason,
        stats: active ? rule.stats : {},
        skills: active ? rule.skills ?? [] : [],
      };
      traces.push(trace);
      if (!active) continue;
      addStats(stats, rule.stats);
      for (const skillId of rule.skills ?? []) {
        if (!catalog.skills[skillId]) {
          unresolvedSkills.push({ skillId, source, ruleId: rule.id });
        }
        skillSet.add(skillId);
      }
    }
  };

  // 物品规则：被封禁槽位中的物品规则全部标记为 inactive 并给出原因
  for (const e of entries) {
    const item = catalog.items[e.itemId];
    const source: EffectSource = { kind: 'item', uid: e.uid, itemId: e.itemId };
    runRules(
      item.effects,
      source,
      e.suppressed
        ? () => ({ allowed: false, reason: `槽位 ${e.slot} 被临时封禁，物品完全失效` })
        : undefined,
    );
  }

  // 套装规则：累计激活所有 threshold <= 有效部件数的档位
  for (const [setId, highest] of Object.entries(setTiers)) {
    const set = catalog.sets[setId];
    for (const tier of set.tiers) {
      const source: EffectSource = { kind: 'set', setId, threshold: tier.threshold };
      runRules(tier.effects, source, () =>
        tier.threshold <= highest
          ? { allowed: true }
          : { allowed: false, reason: `套装 ${setId} 当前为第 ${highest} 档，未达第 ${tier.threshold} 档` },
      );
    }
  }

  return {
    stats,
    skills: [...skillSet],
    setTiers,
    setPieceCounts: pieceCounts,
    suppressed,
    traces,
    unresolvedSkills,
  };
}
