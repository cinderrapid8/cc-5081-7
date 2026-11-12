import { evaluate } from '../src/domain/evaluate';
import { IncrementalEvaluator } from '../src/domain/incremental';
import { compareDerived, compareChangeReports, diffSources } from '../src/domain/equivalence';
import { buildChangeReport, type ChangeReport } from '../src/domain/publish';
import { generateScaleCatalog, scaledBaseStats, smallScenario } from './scenario';
import type { Catalog, DerivedState, Loadout, StatMap } from '../src/domain/types';

export interface ScaleConfig {
  label: string;
  /** 槽位数 = 同时在装的装备规模 */
  slotCount: number;
  variantsPerSlot: number;
  setCount: number;
  tiersPerSet: number;
  effectsPerItem: number;
  statPool: number;
  tagPool: number;
}

export const SCALES: ScaleConfig[] = [
  { label: 'small', slotCount: 6, variantsPerSlot: 3, setCount: 2, tiersPerSet: 3, effectsPerItem: 2, statPool: 9, tagPool: 2 },
  { label: 'n16', slotCount: 16, variantsPerSlot: 4, setCount: 4, tiersPerSet: 4, effectsPerItem: 4, statPool: 12, tagPool: 4 },
  { label: 'n32', slotCount: 32, variantsPerSlot: 6, setCount: 8, tiersPerSet: 5, effectsPerItem: 6, statPool: 15, tagPool: 8 },
  { label: 'n64', slotCount: 64, variantsPerSlot: 8, setCount: 16, tiersPerSet: 5, effectsPerItem: 8, statPool: 15, tagPool: 12 },
];

/** 一次修改覆盖的范围：单槽位 / 整套（跨多个阈值）/ 整备换装 */
export type ChangeScope = 'single-slot' | 'single-set' | 'all-slots';

export const SCOPES: ChangeScope[] = ['single-slot', 'single-set', 'all-slots'];

export interface Prepared {
  catalog: Catalog;
  inventory: { uid: string; itemId: string }[];
  baseStats: StatMap;
  loadouts: { before: Loadout; after: Loadout }[];
  slotOptions: Record<string, string[]>;
  notes: string;
}

function makeRand(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function pick(rand: () => number, arr: string[]): string | null {
  if (!arr.length) return null;
  return arr[Math.floor(rand() * arr.length)];
}

export function buildScenario(scale: ScaleConfig, scope: ChangeScope, steps: number): Prepared {
  if (scale.label === 'small') {
    const small = smallScenario();
    const slots = small.catalog.slots.map((s) => s.id);
    const rand = makeRand(99);
    const base: Loadout = {};
    for (const slot of slots) base[slot] = pick(rand, small.slotOptions[slot] ?? []);
    const pairs: { before: Loadout; after: Loadout }[] = [];
    for (let i = 0; i < steps; i++) {
      const before: Loadout = { ...base };
      const after: Loadout = { ...base };
      if (scope === 'all-slots') {
        for (const slot of slots) after[slot] = pick(rand, small.slotOptions[slot] ?? []);
      } else {
        const slot = slots[i % slots.length];
        after[slot] = pick(rand, small.slotOptions[slot] ?? []);
      }
      pairs.push({ before, after });
      for (const slot of slots) base[slot] = after[slot];
    }
    return {
      catalog: small.catalog,
      inventory: small.inventory,
      baseStats: scaledBaseStats(9),
      loadouts: pairs,
      slotOptions: small.slotOptions,
      notes: '种子目录（6 槽位 / 13 物品 / 2 套）',
    };
  }

  const generated = generateScaleCatalog({
    slotCount: scale.slotCount,
    variantsPerSlot: scale.variantsPerSlot,
    effectsPerItem: scale.effectsPerItem,
    setCount: scale.setCount,
    tiersPerSet: scale.tiersPerSet,
    statPool: scale.statPool,
    tagPool: scale.tagPool,
    seed: 20261112 + scale.slotCount,
  });
  const slots = generated.catalog.slots.map((s) => s.id);
  const rand = makeRand(7777 + scale.slotCount);
  const base: Loadout = {};
  for (const slot of slots) base[slot] = pick(rand, generated.slotOptions[slot] ?? []);
  const pairs: { before: Loadout; after: Loadout }[] = [];

  for (let i = 0; i < steps; i++) {
    const before: Loadout = { ...base };
    const after: Loadout = { ...base };
    if (scope === 'single-slot') {
      const slot = slots[i % slots.length];
      after[slot] = pick(rand, generated.slotOptions[slot] ?? []);
    } else if (scope === 'single-set') {
      const setIndex = i % scale.setCount;
      const setItems = Object.values(generated.catalog.items).filter((it) => it.setId === `set_${setIndex}`);
      const touchedSlots = new Set(setItems.flatMap((m) => m.slots));
      for (const slot of touchedSlots) {
        const candidates = generated.inventory
          .filter((inst) => generated.catalog.items[inst.itemId]?.setId === `set_${setIndex}`)
          .filter((inst) => generated.catalog.items[inst.itemId].slots.includes(slot))
          .map((inst) => inst.uid);
        after[slot] = candidates.length ? pick(rand, candidates) : pick(rand, generated.slotOptions[slot] ?? []);
      }
    } else {
      for (const slot of slots) after[slot] = pick(rand, generated.slotOptions[slot] ?? []);
    }
    pairs.push({ before, after });
    for (const slot of slots) base[slot] = after[slot];
  }
  return {
    catalog: generated.catalog,
    inventory: generated.inventory,
    baseStats: scaledBaseStats(scale.statPool),
    loadouts: pairs,
    slotOptions: generated.slotOptions,
    notes: `${scale.slotCount} 槽位 / ${scale.slotCount * scale.variantsPerSlot} 物品 / ${scale.setCount} 套 / 每套 ${scale.tiersPerSet} 档`,
  };
}

export interface TimingResult {
  scale: string;
  scope: ChangeScope;
  steps: number;
  items: number;
  rules: number;
  setTiers: number;
  avgFullMs: number;
  avgIncMs: number;
  ratio: number;
  avgIncDepMs: number;
  avgIncThresholdMs: number;
  avgIncPublishMs: number;
  avgRulesEvaluated: number;
  avgRulesReused: number;
  avgRulesEmitted: number;
  equivalent: boolean;
  differenceCount: number;
  deactivationMatch: boolean;
  changeReportMatch: boolean;
}

function time<T>(fn: () => T): { value: T; ms: number } {
  const start = process.hrtime.bigint();
  const value = fn();
  return { value, ms: Number(process.hrtime.bigint() - start) / 1e6 };
}

export function runTiming(
  scale: ScaleConfig,
  scope: ChangeScope,
  steps: number,
  rounds = 1,
): TimingResult {
  const prepared = buildScenario(scale, scope, steps);
  const { catalog, inventory, baseStats, loadouts } = prepared;

  const warm = loadouts[0]?.before ?? {};
  // 预热两条路径：索引建立由独立探针测量，这里的构造不计入任何阶段
  const warmEvaluator = new IncrementalEvaluator(catalog, inventory);
  for (let i = 0; i < 64; i++) {
    evaluate({ catalog, inventory, loadout: warm, bannedSlots: [], baseStats });
    warmEvaluator.evaluate({ loadout: warm, bannedSlots: [], baseStats });
  }

  // 两条路径分轮次计时：交替调用会让共享的条件求值调用点变成多态，压低双方时钟；
  // 各自在独立循环里跑完整变更序列，输入序列完全相同。
  // 单次修改在几十微秒量级，容器调度噪声足以翻转单轮结论，因此默认重复多轮再取平均。
  // 全量轮次的结果留作基准，增量轮次逐步与其对照（含撤销事件与变化报告）。
  let fullTotal = 0;
  let incTotal = 0;
  let incDep = 0;
  let incThreshold = 0;
  let incPublish = 0;
  let evaluated = 0;
  let reused = 0;
  let emitted = 0;
  let equivalent = true;
  let differenceCount = 0;
  let deactivationMatch = true;
  let changeReportMatch = true;

  const refStates: DerivedState[] = [];
  const refReports: ChangeReport[] = [];
  const refDiffs: string[] = [];
  let prevRef = evaluate({ catalog, inventory, loadout: warm, bannedSlots: [], baseStats });
  for (let round = 0; round < rounds; round++) {
    for (const pair of loadouts) {
      const full = time(() => evaluate({ catalog, inventory, loadout: pair.after, bannedSlots: [], baseStats }));
      fullTotal += full.ms;
      if (round === 0) {
        refStates.push(full.value);
        refReports.push(buildChangeReport(prevRef, full.value, 1));
        refDiffs.push(JSON.stringify(diffSources(prevRef, full.value)));
        prevRef = full.value;
      }
    }
  }

  for (let round = 0; round < rounds; round++) {
    const evaluator = new IncrementalEvaluator(catalog, inventory);
    let prevInc = evaluator.evaluate({ loadout: warm, bannedSlots: [], baseStats }).derived;
    for (let i = 0; i < loadouts.length; i++) {
      const pair = loadouts[i];
      const inc = time(() => evaluator.evaluate({ loadout: pair.after, bannedSlots: [], baseStats }));
      incTotal += inc.ms;
      const m = inc.value.metrics;
      incDep += m.dependencyLookupMs;
      incThreshold += m.thresholdUpdateMs;
      incPublish += m.effectPublishMs;
      evaluated += m.rulesEvaluated;
      reused += m.rulesReused;
      emitted += m.rulesEmitted;

      if (round === 0) {
        const cmp = compareDerived(refStates[i], inc.value.derived);
        if (!cmp.equivalent) {
          equivalent = false;
          differenceCount += cmp.differences.length;
        }
        if (compareChangeReports(refReports[i], buildChangeReport(prevInc, inc.value.derived, 1)).length) {
          changeReportMatch = false;
        }
        if (JSON.stringify(diffSources(prevInc, inc.value.derived)) !== refDiffs[i]) deactivationMatch = false;
      }
      prevInc = inc.value.derived;
    }
  }

  const n = loadouts.length * rounds;
  const ruleCount = warmEvaluator.ruleCount;
  return {
    scale: prepared.notes,
    scope,
    steps: n,
    items: Object.keys(catalog.items).length,
    rules: ruleCount,
    setTiers: Object.keys(catalog.sets).reduce((acc, s) => acc + catalog.sets[s].tiers.length, 0),
    avgFullMs: fullTotal / n,
    avgIncMs: incTotal / n,
    ratio: incTotal === 0 ? 0 : fullTotal / incTotal,
    avgIncDepMs: incDep / n,
    avgIncThresholdMs: incThreshold / n,
    avgIncPublishMs: incPublish / n,
    avgRulesEvaluated: evaluated / n,
    avgRulesReused: reused / n,
    avgRulesEmitted: emitted / n,
    equivalent,
    differenceCount,
    deactivationMatch,
    changeReportMatch,
  };
}

export interface AllocationResult {
  scale: string;
  scope: ChangeScope;
  steps: number;
  /** 索引建立阶段分配的字节数（含索引容器、依赖反查表） */
  indexBuildBytes: number;
  fullTotalBytes: number;
  incTotalBytes: number;
  fullPerStepBytes: number;
  incPerStepBytes: number;
  ratio: number;
}

/**
 * 分配量探针（由 bench/run-bench.ts 在独立子进程内调用）：
 * 每个阶段前强制 GC 并写开始标记，阶段结束后强制 GC 并写结束标记；
 * 父进程从 stdout 的 --trace-gc-nvp 输出中累加两标记之间的 allocated 字节。
 */
export interface ProbePhase {
  name: string;
  run: () => number;
}

export function buildAllocationPhases(scale: ScaleConfig, scope: ChangeScope, steps: number): {
  phases: ProbePhase[];
  meta: { scale: string; scope: ChangeScope; steps: number };
} {
  const prepared = buildScenario(scale, scope, steps);
  const { catalog, inventory, baseStats, loadouts } = prepared;

  const phases: ProbePhase[] = [];
  let evaluator: IncrementalEvaluator | null = null;
  let sink = 0;

  phases.push({
    name: 'index-build',
    run: () => {
      evaluator = new IncrementalEvaluator(catalog, inventory);
      return evaluator.ruleCount;
    },
  });

  const warm = loadouts[0]?.before ?? {};
  phases.push({
    name: 'warmup',
    run: () => {
      evaluate({ catalog, inventory, loadout: warm, bannedSlots: [], baseStats });
      evaluator!.evaluate({ loadout: warm, bannedSlots: [], baseStats });
      return 1;
    },
  });

  phases.push({
    name: 'full',
    run: () => {
      for (const pair of loadouts) {
        const d = evaluate({ catalog, inventory, loadout: pair.after, bannedSlots: [], baseStats });
        sink += d.traces.length;
      }
      return sink;
    },
  });

  phases.push({
    name: 'incremental',
    run: () => {
      for (const pair of loadouts) {
        const r = evaluator!.evaluate({ loadout: pair.after, bannedSlots: [], baseStats });
        sink += r.derived.traces.length;
      }
      return sink;
    },
  });

  return {
    phases,
    meta: { scale: prepared.notes, scope, steps: loadouts.length },
  };
}
