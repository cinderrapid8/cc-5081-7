import type {
  Catalog,
  DerivedState,
  EffectSource,
  EffectTrace,
  Loadout,
  SlotId,
  StatKey,
  StatMap,
  SuppressedItem,
} from './types';
import { addStats, evalCondition } from './conditions';

import { buildEffectIndex, type EffectIndex, type IndexedRule } from './effectIndex';

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

const EMPTY_SLOT_SET: Set<SlotId> = new Set();

export interface IncrementalMetrics {
  mode: 'incremental';
  changedSlots: number;
  changedTags: number;
  changedSetTiers: number;
  invalidatedRules: number;
  rulesEvaluated: number;
  rulesReused: number;
  rulesEmitted: number;
  dependencyLookupMs: number;
  thresholdUpdateMs: number;
  effectPublishMs: number;
  totalMs: number;
  indexBuildMs: number;
  indexBuilds: number;
}

export interface IncrementalEvalArgs {
  loadout: Loadout;
  bannedSlots: SlotId[];
  baseStats: StatMap;
}

export interface IncrementalResult {
  derived: DerivedState;
  metrics: IncrementalMetrics;
}

interface ResolvedEntry {
  slot: SlotId;
  uid: string;
  itemId: string;
  suppressed: boolean;
}

interface CachedRule {
  trace: EffectTrace;
  active: boolean;
}

/** 静态规则的运行期脏标记：条件依赖变化时置脏，重算后清除（索引本身只读） */
interface DirtyRule extends IndexedRule {
  dirty?: boolean;
}

/** 单槽位的整块输出：未受影响的槽位直接复用，无需逐规则查询 */
interface SlotAggregate {
  traces: EffectTrace[];
  stats: StatMap;
  skills: string[];
  unresolved: { skillId: string; source: EffectSource; ruleId: string }[];
}

interface SlotCache {
  uid: string;
  itemId: string;
  suppressed: boolean;
  /** 与 item.rules 同序的规则缓存，避免每次重算都做 Map 查找 */
  rules: Array<CachedRule | undefined>;
  aggregate: SlotAggregate;
}

/** 单个套装的整块输出（含全部档位规则，未达档位以 inactive 原因保留） */
interface SetAggregate {
  traces: EffectTrace[];
  stats: StatMap;
  skills: string[];
  unresolved: { skillId: string; source: EffectSource; ruleId: string }[];
  /** 构建时的档位数，用于判断是否需要重建 */
  highest: number;
}

interface InternalState {
  entries: Map<SlotId, ResolvedEntry>;
  slotCache: Map<SlotId, SlotCache>;
  /** itemId -> 当前在装该物品的槽位集合，用于把规则失效映射回槽位 */
  slotsByItem: Map<string, Set<SlotId>>;
  /** 需要重建聚合的槽位 */
  dirtySlots: Set<SlotId>;
  /** 套装规则缓存：setId -> [档位][规则] 的二维数组，与 index.sets 顺序一致 */
  setCache: Map<string, Array<Array<CachedRule | undefined>>>;
  /** 每个在装套装的整块输出；只有档位或依赖变化时才重建 */
  setAggregates: Map<string, SetAggregate>;
  /** 需要重建整块输出的套装 */
  dirtySets: Set<string>;
  tagCounts: Map<string, number>;
  pieceCounts: Map<string, number>;
  setTiers: Map<string, number>;
  tagPresence: Set<string>;
  /** 本次求值中出现/消失的标签（0↔1 翻转），用于只沿翻转项查依赖 */
  tagFlips: Set<string>;
  baseStatsSnapshot: Map<StatKey, number>;
  setTiersRecord: Record<string, number>;
  setTiersDirty: boolean;
}

interface DependencyLookup {
  byTag: Map<string, IndexedRule[]>;
  bySet: Map<string, IndexedRule[]>;
  byStat: Map<StatKey, IndexedRule[]>;
}

function emptyState(): InternalState {
  return {
    entries: new Map(),
    slotCache: new Map(),
    slotsByItem: new Map(),
    dirtySlots: new Set(),
    setCache: new Map(),
    setAggregates: new Map(),
    dirtySets: new Set(),
    tagCounts: new Map(),
    pieceCounts: new Map(),
    setTiers: new Map(),
    tagPresence: new Set(),
    tagFlips: new Set(),
    baseStatsSnapshot: new Map(),
    setTiersRecord: {},
    setTiersDirty: true,
  };
}

function buildDependencyLookup(index: EffectIndex): DependencyLookup {
  const byTag = new Map<string, IndexedRule[]>();
  const bySet = new Map<string, IndexedRule[]>();
  const byStat = new Map<StatKey, IndexedRule[]>();
  const push = <K>(map: Map<K, IndexedRule[]>, dep: K, rule: IndexedRule) => {
    const list = map.get(dep);
    if (list) list.push(rule);
    else map.set(dep, [rule]);
  };
  const register = (rule: IndexedRule) => {
    for (const tag of rule.depTags) push(byTag, tag, rule);
    for (const setId of rule.depSets) push(bySet, setId, rule);
    for (const stat of rule.depStats) push(byStat, stat, rule);
  };
  for (const item of index.items.values()) for (const rule of item.rules) register(rule);
  for (const tiers of index.sets.values()) {
    for (const tier of tiers) for (const rule of tier.rules) register(rule);
  }
  return { byTag, bySet, byStat };
}

/**
 * 增量求值器。把原本“每次全量重建所有套装与条件表达式”的开销拆为三段：
 *   1. 依赖查找：静态索引把规则按 标签 / 套装档位 / 基础属性键 建反向表；
 *   2. 阈值更新：只对部件数变化的套装重算档位；
 *   3. 效果发布：以“槽位 / 套装”为单位缓存整块输出（trace 数组 / 属性 / 技能），
 *      未受影响的块只做引用拼接，发布成本与受影响槽位数成正比，而不是与规则总数成正比。
 *
 * 任何影响某条规则的条件（标签翻转、档位变化、基础属性变化）都会把持有该规则的槽位标脏；
 * 被标脏的槽位在发布阶段重算该物品的全部规则并重建聚合。来源（实例 uid / 套装档位）随槽位缓存
 * 一起丢弃重建，因此多次修改后来源关系仍与当前负载一致，卸装不会留下错误来源。
 * 目录版本切换必须调用 rebase()：索引、依赖表与全部缓存会被清空并基于新目录重建。
 */
export class IncrementalEvaluator {
  private catalog: Catalog;
  private index: EffectIndex;
  private deps: DependencyLookup;
  private inventoryByUid: Map<string, string>;
  private state: InternalState = emptyState();
  private builds = 0;
  private lastIndexBuildMs = 0;
  private lastMetrics: IncrementalMetrics | null = null;

  constructor(catalog: Catalog, inventory: { uid: string; itemId: string }[]) {
    this.catalog = catalog;
    this.index = this.buildIndex(catalog);
    this.deps = buildDependencyLookup(this.index);
    this.inventoryByUid = new Map(inventory.map((i) => [i.uid, i.itemId]));
  }

  private buildIndex(catalog: Catalog): EffectIndex {
    const t0 = now();
    const index = buildEffectIndex(catalog);
    this.lastIndexBuildMs = now() - t0;
    this.builds++;
    return index;
  }

  setInventory(inventory: { uid: string; itemId: string }[]): void {
    this.inventoryByUid = new Map(inventory.map((i) => [i.uid, i.itemId]));
    this.state = emptyState();
  }

  rebase(catalog: Catalog): void {
    this.catalog = catalog;
    this.index = this.buildIndex(catalog);
    this.deps = buildDependencyLookup(this.index);
    this.state = emptyState();
  }

  get currentCatalog(): Catalog {
    return this.catalog;
  }

  get indexBuildMs(): number {
    return this.lastIndexBuildMs;
  }

  get indexBuilds(): number {
    return this.builds;
  }

  get ruleCount(): number {
    return this.index.ruleCount;
  }

  get indexStats() {
    return this.index.build;
  }

  get lastRunMetrics(): IncrementalMetrics | null {
    return this.lastMetrics;
  }

  asDeriveFn(): (loadout: Loadout, bannedSlots: SlotId[], baseStats: StatMap) => DerivedState {
    return (loadout, bannedSlots, baseStats) =>
      this.evaluate({ loadout, bannedSlots, baseStats }).derived;
  }

  /**
   * 解析负载条目。未变化的槽位复用上一轮的对象身份：diff 可退化为引用比较，
   * 干净槽位的发布缓存也因此不需要重新绑定来源。
   */
  private resolveEntries(loadout: Loadout, bannedSlots: SlotId[]): Map<SlotId, ResolvedEntry> {
    const banned = bannedSlots.length ? new Set(bannedSlots) : EMPTY_SLOT_SET;
    const prev = this.state.entries;
    const out = new Map<SlotId, ResolvedEntry>();
    for (const [slot, uid] of Object.entries(loadout)) {
      if (!uid) continue;
      const itemId = this.inventoryByUid.get(uid);
      if (!itemId || !this.catalog.items[itemId]) continue;
      const suppressed = banned.has(slot);
      const old = prev.get(slot);
      if (old && old.uid === uid && old.itemId === itemId && old.suppressed === suppressed) {
        out.set(slot, old);
      } else {
        out.set(slot, { slot, uid, itemId, suppressed });
      }
    }
    return out;
  }

  private registerSlotItem(entry: ResolvedEntry): void {
    let set = this.state.slotsByItem.get(entry.itemId);
    if (!set) {
      set = new Set();
      this.state.slotsByItem.set(entry.itemId, set);
    }
    set.add(entry.slot);
  }

  private unregisterSlotItem(entry: ResolvedEntry): void {
    const set = this.state.slotsByItem.get(entry.itemId);
    if (!set) return;
    set.delete(entry.slot);
    if (set.size === 0) this.state.slotsByItem.delete(entry.itemId);
  }

  private adjustContributions(entry: ResolvedEntry, direction: 1 | -1): void {
    const item = this.index.items.get(entry.itemId);
    if (!item) return;
    for (const tag of item.tags) {
      const prev = this.state.tagCounts.get(tag) ?? 0;
      const next = prev + direction;
      if (next <= 0) {
        this.state.tagCounts.delete(tag);
        this.state.tagPresence.delete(tag);
      } else {
        this.state.tagCounts.set(tag, next);
        this.state.tagPresence.add(tag);
      }
      if ((prev > 0) !== (next > 0)) this.state.tagFlips.add(tag);
    }
    if (item.setId) {
      const next = (this.state.pieceCounts.get(item.setId) ?? 0) + direction;
      if (next <= 0) this.state.pieceCounts.delete(item.setId);
      else this.state.pieceCounts.set(item.setId, next);
    }
  }

  private computeTier(setId: string): number {
    const count = this.state.pieceCounts.get(setId) ?? 0;
    const tiers = this.index.sets.get(setId) ?? [];
    let highest = 0;
    for (const tier of tiers) if (count >= tier.threshold) highest = tier.threshold;
    return highest;
  }

  /** 把一条失效规则映射到需要重建的缓存：物品规则 -> 持有该物品的槽位；套装规则 -> 套装整块输出 */
  private invalidateRule(rule: IndexedRule): void {
    (rule as DirtyRule).dirty = true;
    if (rule.sourceKind === 'set') {
      if (rule.setId) this.state.dirtySets.add(rule.setId);
      return;
    }
    const slots = this.state.slotsByItem.get(rule.itemId!);
    if (!slots) return;
    for (const slot of slots) this.state.dirtySlots.add(slot);
  }

  evaluate(args: IncrementalEvalArgs): IncrementalResult {
    const totalStart = now();
    const { loadout, bannedSlots, baseStats } = args;
    const metrics: IncrementalMetrics = {
      mode: 'incremental',
      changedSlots: 0,
      changedTags: 0,
      changedSetTiers: 0,
      invalidatedRules: 0,
      rulesEvaluated: 0,
      rulesReused: 0,
      rulesEmitted: 0,
      dependencyLookupMs: 0,
      thresholdUpdateMs: 0,
      effectPublishMs: 0,
      totalMs: 0,
      indexBuildMs: this.lastIndexBuildMs,
      indexBuilds: this.builds,
    };

    // ---- 阶段一：依赖查找 ----
    const depStart = now();
    const newEntries = this.resolveEntries(loadout, bannedSlots);
    const oldEntries = this.state.entries;
    const changedSlotIds = new Set<SlotId>();
    for (const [slot, oldE] of oldEntries) {
      if (newEntries.get(slot) !== oldE) changedSlotIds.add(slot);
    }
    for (const [slot, newE] of newEntries) {
      if (oldEntries.get(slot) !== newE) changedSlotIds.add(slot);
    }
    metrics.changedSlots = changedSlotIds.size;

    const statChanges: StatKey[] = [];
    for (const key of Object.keys(baseStats) as StatKey[]) {
      if ((this.state.baseStatsSnapshot.get(key) ?? 0) !== (baseStats[key] ?? 0)) statChanges.push(key);
    }
    if (this.state.baseStatsSnapshot.size !== Object.keys(baseStats).length) {
      for (const key of this.state.baseStatsSnapshot.keys()) {
        if (!(key in baseStats)) statChanges.push(key);
      }
    }
    metrics.dependencyLookupMs += now() - depStart;

    // ---- 阶段二：阈值更新 ----
    const thresholdStart = now();
    for (const slot of changedSlotIds) {
      const oldE = oldEntries.get(slot);
      if (oldE) {
        if (!oldE.suppressed) this.adjustContributions(oldE, -1);
        this.unregisterSlotItem(oldE);
        this.dropSlotAggregate(oldE.slot);
      }
      const newE = newEntries.get(slot);
      if (newE) {
        if (!newE.suppressed) this.adjustContributions(newE, +1);
        this.registerSlotItem(newE);
      }
    }
    this.state.entries = newEntries;

    const touchedSets = new Set<string>();
    for (const slot of changedSlotIds) {
      const oldE = oldEntries.get(slot);
      const newE = newEntries.get(slot);
      if (oldE && !oldE.suppressed) {
        const setId = this.index.items.get(oldE.itemId)?.setId;
        if (setId) touchedSets.add(setId);
      }
      if (newE && !newE.suppressed) {
        const setId = this.index.items.get(newE.itemId)?.setId;
        if (setId) touchedSets.add(setId);
      }
    }
    for (const setId of touchedSets) {
      const nextTier = this.computeTier(setId);
      const prevTier = this.state.setTiers.get(setId) ?? 0;
      if (nextTier === prevTier) continue;
      metrics.changedSetTiers++;
      if (nextTier > 0) this.state.setTiers.set(setId, nextTier);
      else this.state.setTiers.delete(setId);
      this.state.setTiersDirty = true;
      const tiers = this.index.sets.get(setId);
      for (const rule of this.deps.bySet.get(setId) ?? []) this.invalidateRule(rule);
      if (tiers) {
        for (const tier of tiers) for (const rule of tier.rules) (rule as DirtyRule).dirty = true;
      }
    }
    metrics.thresholdUpdateMs += now() - thresholdStart;

    // 标签存在性翻转与基础属性变化：沿反向表标记失效
    const depStart2 = now();
    let invalidated = 0;
    // 标签失效只看本次真正发生 0↔1 翻转的标签；标签数远小于全目录依赖表规模
    for (const tag of this.state.tagFlips) {
      const rules = this.deps.byTag.get(tag);
      if (!rules) continue;
      metrics.changedTags++;
      for (const rule of rules) {
        this.invalidateRule(rule);
        invalidated++;
      }
    }
    this.state.tagFlips.clear();
    for (const stat of statChanges) {
      for (const rule of this.deps.byStat.get(stat) ?? []) {
        this.invalidateRule(rule);
        invalidated++;
      }
    }
    const snapStats = this.state.baseStatsSnapshot;
    snapStats.clear();
    for (const key of Object.keys(baseStats) as StatKey[]) snapStats.set(key, baseStats[key] ?? 0);
    metrics.dependencyLookupMs += now() - depStart2;
    metrics.invalidatedRules = invalidated;

    if (this.state.setTiersDirty) {
      this.state.setTiersRecord = Object.fromEntries(this.state.setTiers) as Record<string, number>;
      this.state.setTiersDirty = false;
    }

    // ---- 阶段三：效果发布（按槽位 / 套装整块缓存，干净部分只拼接不重算） ----
    const publishStart = now();
    const condCtx = {
      baseStats,
      setTiers: this.state.setTiersRecord,
      activeTags: this.state.tagPresence,
    };

    // 发布顺序：物品规则按负载槽位顺序，套装规则按负载中首次出现的套装顺序（与全量路径一致）
    const slotOrder = [...newEntries.keys()];
    const activeSetIds = new Set<string>();
    const setOrder: string[] = [];
    const seenSetIds = new Set<string>();
    for (const entry of newEntries.values()) {
      if (entry.suppressed) continue;
      const setId = this.index.items.get(entry.itemId)?.setId;
      if (!setId) continue;
      activeSetIds.add(setId);
      if (!seenSetIds.has(setId)) {
        seenSetIds.add(setId);
        setOrder.push(setId);
      }
    }
    for (const setId of setOrder) {
      const highest = this.state.setTiers.get(setId) ?? 0;
      const cached = this.state.setAggregates.get(setId);
      if (highest === 0) {
        if (cached) this.state.setAggregates.delete(setId);
        continue;
      }
      if (cached && !this.state.dirtySets.has(setId) && cached.highest === highest) {
        metrics.rulesReused += cached.traces.length;
        continue;
      }
      const tiers = this.index.sets.get(setId)!;
      const agg: SetAggregate = {
        traces: [],
        stats: {},
        skills: [],
        unresolved: [],
        highest,
      };
      let setRules = this.state.setCache.get(setId);
      if (!setRules) {
        setRules = tiers.map(() => []);
        this.state.setCache.set(setId, setRules);
      }
      for (let ti = 0; ti < tiers.length; ti++) {
        const tier = tiers[ti];
        const gateReason =
          tier.threshold <= highest
            ? undefined
            : `套装 ${setId} 当前为第 ${highest} 档，未达第 ${tier.threshold} 档`;
        const tierCache = setRules[ti];
        for (let ri = 0; ri < tier.rules.length; ri++) {
          const rule = tier.rules[ri];
          let ruleCached = tierCache[ri];
          if (!ruleCached || (rule as DirtyRule).dirty) {
            ruleCached = this.evaluateRule(rule, condCtx, undefined, gateReason);
            tierCache[ri] = ruleCached;
            (rule as DirtyRule).dirty = false;
            metrics.rulesEvaluated++;
          } else {
            metrics.rulesReused++;
          }
          const trace = ruleCached.trace;
          agg.traces.push(trace);
          if (!ruleCached.active) continue;
          addStats(agg.stats, trace.stats);
          for (const skillId of trace.skills) {
            agg.skills.push(skillId);
            if (!this.catalog.skills[skillId]) {
              agg.unresolved.push({ skillId, source: trace.source, ruleId: trace.ruleId });
            }
          }
        }
      }
      this.state.setAggregates.set(setId, agg);
    }
    for (const setId of [...this.state.setAggregates.keys()]) {
      if (!activeSetIds.has(setId)) this.state.setAggregates.delete(setId);
    }
    this.state.dirtySets.clear();

    // 槽位：只为脏槽位重建聚合；干净槽位整块复用
    for (const [slot] of oldEntries) {
      if (!newEntries.has(slot)) this.dropSlotAggregate(slot);
    }
    for (const slot of slotOrder) {
      const entry = newEntries.get(slot);
      if (!entry) continue;
      const item = this.index.items.get(entry.itemId);
      if (!item) continue;
      let cache = this.state.slotCache.get(slot);
      if (!cache) {
        cache = {
          uid: entry.uid,
          itemId: entry.itemId,
          suppressed: entry.suppressed,
          rules: [],
          aggregate: { traces: [], stats: {}, skills: [], unresolved: [] },
        };
        this.state.slotCache.set(slot, cache);
        this.state.dirtySlots.add(slot);
      }
      if (!this.state.dirtySlots.has(slot)) {
        metrics.rulesReused += item.rules.length;
        continue;
      }
      // 重建该槽位聚合：脏槽位整体重算其物品规则，未被失效的规则复用逐规则缓存
      cache.uid = entry.uid;
      cache.itemId = entry.itemId;
      cache.suppressed = entry.suppressed;
      const agg = cache.aggregate;
      agg.traces.length = 0;
      agg.stats = {};
      agg.skills.length = 0;
      agg.unresolved.length = 0;
      const slotRules = cache.rules;
      if (slotRules.length !== item.rules.length) slotRules.length = item.rules.length;
      for (let ri = 0; ri < item.rules.length; ri++) {
        const rule = item.rules[ri];
        let ruleCached = slotRules[ri];
        if (!ruleCached || (rule as DirtyRule).dirty) {
          ruleCached = this.evaluateRule(rule, condCtx, entry);
          slotRules[ri] = ruleCached;
          (rule as DirtyRule).dirty = false;
          metrics.rulesEvaluated++;
        } else {
          metrics.rulesReused++;
        }
        const trace = ruleCached.trace;
        agg.traces.push(trace);
        if (!ruleCached.active) continue;
        addStats(agg.stats, trace.stats);
        for (const skillId of trace.skills) {
          agg.skills.push(skillId);
          if (!this.catalog.skills[skillId]) {
            agg.unresolved.push({ skillId, source: trace.source, ruleId: trace.ruleId });
          }
        }
      }
      this.state.dirtySlots.delete(slot);
    }

    // 拼接发布：干净槽位/套装仅追加缓存块，不再逐规则记账。
    // 属性按发布顺序聚合（槽位块在前、套装块在后），与全量路径累加次序一致，
    // 浮点结果逐位相同，无需容差或归整。
    const traces: EffectTrace[] = [];
    const unresolvedSkills: DerivedState['unresolvedSkills'] = [];
    const stats: StatMap = {};
    for (const slot of slotOrder) {
      const cache = this.state.slotCache.get(slot);
      if (!cache) continue;
      const agg = cache.aggregate;
      metrics.rulesEmitted += agg.traces.length;
      addStats(stats, agg.stats);
      for (const t of agg.traces) traces.push(t);
      for (const u of agg.unresolved) unresolvedSkills.push(u);
    }
    for (const setId of setOrder) {
      const agg = this.state.setAggregates.get(setId);
      if (!agg) continue;
      metrics.rulesEmitted += agg.traces.length;
      addStats(stats, agg.stats);
      for (const t of agg.traces) traces.push(t);
      for (const u of agg.unresolved) unresolvedSkills.push(u);
    }

    const suppressed: SuppressedItem[] = [];
    for (const entry of this.state.entries.values()) {
      if (entry.suppressed) {
        suppressed.push({ uid: entry.uid, itemId: entry.itemId, slot: entry.slot, reason: 'slot-banned' });
      }
    }

    const setPieceCounts: Record<string, number> = {};
    const setTiers: Record<string, number> = {};
    for (const entry of this.state.entries.values()) {
      if (entry.suppressed) continue;
      const setId = this.index.items.get(entry.itemId)?.setId;
      if (!setId || setPieceCounts[setId] !== undefined) continue;
      setPieceCounts[setId] = this.state.pieceCounts.get(setId) ?? 0;
      const tier = this.state.setTiers.get(setId) ?? 0;
      if (tier > 0) setTiers[setId] = tier;
    }

    // 技能顺序与全量路径一致：按发布顺序的激活 trace 首次出现。
    // 槽位/套装聚合已按同样顺序保存了激活技能，直接按聚合顺序合并即可。
    const skillSet = new Set<string>();
    for (const slot of slotOrder) {
      const cache = this.state.slotCache.get(slot);
      if (cache) for (const skillId of cache.aggregate.skills) skillSet.add(skillId);
    }
    for (const setId of setOrder) {
      const agg = this.state.setAggregates.get(setId);
      if (agg) for (const skillId of agg.skills) skillSet.add(skillId);
    }
    const derived: DerivedState = {
      stats,
      skills: [...skillSet],
      setTiers,
      setPieceCounts,
      suppressed,
      traces,
      unresolvedSkills,
    };
    metrics.rulesEmitted = traces.length;
    metrics.effectPublishMs = now() - publishStart;
    metrics.totalMs = now() - totalStart;
    this.lastMetrics = metrics;
    return { derived, metrics };
  }

  private dropSlotAggregate(slot: SlotId): void {
    const cache = this.state.slotCache.get(slot);
    if (!cache) return;
    this.state.slotCache.delete(slot);
    this.state.dirtySlots.delete(slot);
  }

  private evaluateRule(
    indexed: IndexedRule,
    condCtx: { baseStats: StatMap; setTiers: Record<string, number>; activeTags: Set<string> },
    entry?: ResolvedEntry,
    gateReason?: string,
  ): CachedRule {
    let active = true;
    let inactiveReason: string | undefined;
    if (entry?.suppressed) {
      active = false;
      inactiveReason = `槽位 ${entry.slot} 被临时封禁，物品完全失效`;
    } else if (gateReason) {
      active = false;
      inactiveReason = gateReason;
    }
    if (active) {
      const result = evalCondition(indexed.rule.condition, condCtx);
      if (!result.ok) {
        active = false;
        inactiveReason = result.reason;
      }
    }
    const source: EffectSource =
      indexed.sourceKind === 'item'
        ? { kind: 'item', uid: entry!.uid, itemId: entry!.itemId }
        : { kind: 'set', setId: indexed.setId!, threshold: indexed.threshold! };
    const trace: EffectTrace = {
      ruleId: indexed.rule.id,
      source,
      active,
      inactiveReason,
      stats: active ? indexed.rule.stats : {},
      skills: active ? indexed.rule.skills ?? [] : [],
    };
    return { trace, active };
  }
}
