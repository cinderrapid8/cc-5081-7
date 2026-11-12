import { evaluate } from './evaluate';
import { hasBlockingErrors, validate } from './validate';
import type {
  Catalog,
  DerivedState,
  Diagnostic,
  EffectTrace,
  ItemInstance,
  Loadout,
  StatKey,
  StatMap,
} from './types';

export interface ChangeReport {
  revision: number;
  statDeltas: StatMap;
  skillsGained: string[];
  skillsLost: string[];
  sourcesActivated: string[];
  sourcesDeactivated: string[];
  setTierChanges: { setId: string; from: number; to: number }[];
}

export interface PublishResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  revision?: number;
  loadout?: Loadout;
  derived?: DerivedState;
  changes?: ChangeReport;
}

export interface PublishArgs {
  catalog: Catalog;
  inventory: ItemInstance[];
  draft: Loadout;
  active: Loadout;
  activeDerived: DerivedState;
  bannedSlots: string[];
  alive: boolean;
  baseStats: StatMap;
  currentRevision: number;
}

function traceKey(t: EffectTrace): string {
  return t.source.kind === 'item'
    ? `item:${t.source.uid}:${t.ruleId}`
    : `set:${t.source.setId}:${t.source.threshold}:${t.ruleId}`;
}

function sourceLabel(t: EffectTrace): string {
  return t.source.kind === 'item'
    ? `物品实例 ${t.source.uid} / 规则 ${t.ruleId}`
    : `套装 ${t.source.setId} 第${t.source.threshold}档 / 规则 ${t.ruleId}`;
}

function diffStats(before: StatMap, after: StatMap): StatMap {
  const keys = new Set<StatKey>([
    ...(Object.keys(before) as StatKey[]),
    ...(Object.keys(after) as StatKey[]),
  ]);
  const out: StatMap = {};
  for (const k of keys) out[k] = (after[k] ?? 0) - (before[k] ?? 0);
  return out;
}

/**
 * 发布管线：先完整校验草稿，任何 error 都原样拒绝（active 负载与战斗结果不变）；
 * 通过后单次原子替换负载并全量重算，再产出来源级变化报告。
 * 不存在“先逐件脱装再留下半套”的中间状态。
 */
export function publishRevision(args: PublishArgs): PublishResult {
  const diagnostics = validate({
    catalog: args.catalog,
    inventory: args.inventory,
    loadout: args.draft,
    bannedSlots: args.bannedSlots,
    alive: args.alive,
  });

  if (hasBlockingErrors(diagnostics)) {
    return { ok: false, diagnostics };
  }

  const nextRevision = args.currentRevision + 1;
  const newLoadout: Loadout = { ...args.draft };
  const derived = evaluate({
    catalog: args.catalog,
    inventory: args.inventory,
    loadout: newLoadout,
    bannedSlots: args.bannedSlots,
    baseStats: args.baseStats,
  });

  const beforeActive = new Set(args.activeDerived.traces.filter((t) => t.active).map(traceKey));
  const afterActive = new Set(derived.traces.filter((t) => t.active).map(traceKey));
  const labelByKey = new Map<string, string>();
  for (const t of [...args.activeDerived.traces, ...derived.traces]) {
    labelByKey.set(traceKey(t), sourceLabel(t));
  }

  const sourcesActivated = [...afterActive].filter((k) => !beforeActive.has(k)).map((k) => labelByKey.get(k)!);
  const sourcesDeactivated = [...beforeActive].filter((k) => !afterActive.has(k)).map((k) => labelByKey.get(k)!);

  const skillsGained = derived.skills.filter((s) => !args.activeDerived.skills.includes(s));
  const skillsLost = args.activeDerived.skills.filter((s) => !derived.skills.includes(s));

  const setIds = new Set([
    ...Object.keys(args.activeDerived.setTiers),
    ...Object.keys(derived.setTiers),
  ]);
  const setTierChanges = [...setIds]
    .map((setId) => ({
      setId,
      from: args.activeDerived.setTiers[setId] ?? 0,
      to: derived.setTiers[setId] ?? 0,
    }))
    .filter((c) => c.from !== c.to);

  return {
    ok: true,
    diagnostics,
    revision: nextRevision,
    loadout: newLoadout,
    derived,
    changes: {
      revision: nextRevision,
      statDeltas: diffStats(args.activeDerived.stats, derived.stats),
      skillsGained,
      skillsLost,
      sourcesActivated,
      sourcesDeactivated,
      setTierChanges,
    },
  };
}

/** 草稿预览：即使存在阻断错误也尽力求值，界面必须同时展示诊断，不得把预览当作战斗依据 */
export function previewDraft(args: Omit<PublishArgs, 'active' | 'activeDerived' | 'currentRevision'>): {
  diagnostics: Diagnostic[];
  derived: DerivedState;
} {
  const diagnostics = validate({
    catalog: args.catalog,
    inventory: args.inventory,
    loadout: args.draft,
    bannedSlots: args.bannedSlots,
    alive: args.alive,
  });
  const derived = evaluate({
    catalog: args.catalog,
    inventory: args.inventory,
    loadout: args.draft,
    bannedSlots: args.bannedSlots,
    baseStats: args.baseStats,
  });
  return { diagnostics, derived };
}
