import type { Catalog, Condition, EffectRule, StatKey } from './types';

export interface IndexedRule {
  /** 全局规则身份：item|itemId|ruleId 或 set|setId|threshold|ruleId */
  key: string;
  rule: EffectRule;
  sourceKind: 'item' | 'set';
  itemId?: string;
  setId?: string;
  threshold?: number;
  /** 全局规范排序，仅用于审计与统计 */
  rank: number;
  depTags: string[];
  depSets: string[];
  depStats: StatKey[];
}

export interface ItemIndexEntry {
  itemId: string;
  rules: IndexedRule[];
  tags: string[];
  setId?: string;
}

export interface SetTierIndexEntry {
  threshold: number;
  rules: IndexedRule[];
}

export interface IndexBuildStats {
  buildMs: number;
  items: number;
  setTiers: number;
  sets: number;
  rules: number;
  tagRefs: number;
  dependencyEdges: number;
}

export interface EffectIndex {
  catalog: Catalog;
  items: Map<string, ItemIndexEntry>;
  /** 保持目录中定义的档位顺序，累计激活由阈值比较决定 */
  sets: Map<string, SetTierIndexEntry[]>;
  ruleCount: number;
  build: IndexBuildStats;
}

export function itemRuleKey(itemId: string, ruleId: string): string {
  return `item~${itemId}~${ruleId}`;
}

export function setRuleKey(setId: string, threshold: number, ruleId: string): string {
  return `set~${setId}~${threshold}~${ruleId}`;
}

export function itemInstanceKey(slot: string, itemId: string, ruleId: string): string {
  return `${slot}~${itemRuleKey(itemId, ruleId)}`;
}

function conditionDeps(cond: Condition, rule: IndexedRule): void {
  switch (cond.kind) {
    case 'statAtLeast':
    case 'statAtMost':
      rule.depStats.push(cond.stat);
      break;
    case 'setTierAtLeast':
      rule.depSets.push(cond.setId);
      break;
    case 'hasTag':
      rule.depTags.push(cond.tag);
      break;
    case 'always':
      break;
  }
}

/**
 * 静态引用索引：把目录中的物品规则、套装档位规则及其条件依赖
 * （标签 / 套装档位 / 基础属性键）一次性建成可直接查找的表。
 * 索引只描述目录结构，不持有任何负载状态；目录版本切换必须重建索引。
 */
export function buildEffectIndex(catalog: Catalog): EffectIndex {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const items = new Map<string, ItemIndexEntry>();
  const sets = new Map<string, SetTierIndexEntry[]>();
  let rank = 0;
  let ruleCount = 0;
  let tagRefs = 0;
  let dependencyEdges = 0;

  for (const item of Object.values(catalog.items)) {
    const rules: IndexedRule[] = [];
    for (const rule of item.effects) {
      const indexed: IndexedRule = {
        key: itemRuleKey(item.id, rule.id),
        rule,
        sourceKind: 'item',
        itemId: item.id,
        rank: rank++,
        depTags: [],
        depSets: [],
        depStats: [],
      };
      conditionDeps(rule.condition, indexed);
      dependencyEdges += indexed.depTags.length + indexed.depSets.length + indexed.depStats.length;
      rules.push(indexed);
      ruleCount++;
    }
    tagRefs += item.tags.length;
    items.set(item.id, { itemId: item.id, rules, tags: item.tags, setId: item.setId });
  }

  for (const set of Object.values(catalog.sets)) {
    const tiers: SetTierIndexEntry[] = [];
    for (const tier of set.tiers) {
      const rules: IndexedRule[] = [];
      for (const rule of tier.effects) {
        const indexed: IndexedRule = {
          key: setRuleKey(set.id, tier.threshold, rule.id),
          rule,
          sourceKind: 'set',
          setId: set.id,
          threshold: tier.threshold,
          rank: rank++,
          depTags: [],
          depSets: [],
          depStats: [],
        };
        conditionDeps(rule.condition, indexed);
        dependencyEdges += indexed.depTags.length + indexed.depSets.length + indexed.depStats.length;
        rules.push(indexed);
        ruleCount++;
      }
      tiers.push({ threshold: tier.threshold, rules });
    }
    sets.set(set.id, tiers);
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    catalog,
    items,
    sets,
    ruleCount,
    build: {
      buildMs: t1 - t0,
      items: items.size,
      sets: sets.size,
      setTiers: [...sets.values()].reduce((n, t) => n + t.length, 0),
      rules: ruleCount,
      tagRefs,
      dependencyEdges,
    },
  };
}
