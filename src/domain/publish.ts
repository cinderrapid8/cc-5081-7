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

/** 求值后端：全量参照实现或增量实现，二者必须产出完全相同的派生状态 */
export type DeriveFn = (
  loadout: Loadout,
  bannedSlots: string[],
  baseStats: StatMap,
) => DerivedState;

export function traceKey(t: EffectTrace): string {
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
 * 来源级变化报告：逐来源（物品实例 / 套装档位）比较激活集合，
 * 而不是只看总属性差值，避免“总属性相同但来源关系错误”被误判为等价。
 */
export function buildChangeReport(
  beforeDerived: DerivedState,
  afterDerived: DerivedState,
  revision: number,
): ChangeReport {
  const beforeActive = new Set(beforeDerived.traces.filter((t) => t.active).map(traceKey));
  const afterActive = new Set(afterDerived.traces.filter((t) => t.active).map(traceKey));
  const labelByKey = new Map<string, string>();
  for (const t of [...beforeDerived.traces, ...afterDerived.traces]) {
    labelByKey.set(traceKey(t), sourceLabel(t));
  }

  const sourcesActivated = [...afterActive]
    .filter((k) => !beforeActive.has(k))
    .map((k) => labelByKey.get(k)!);
  const sourcesDeactivated = [...beforeActive]
    .filter((k) => !afterActive.has(k))
    .map((k) => labelByKey.get(k)!);

  const skillsGained = afterDerived.skills.filter((s) => !beforeDerived.skills.includes(s));
  const skillsLost = beforeDerived.skills.filter((s) => !afterDerived.skills.includes(s));

  const setIds = new Set([...Object.keys(beforeDerived.setTiers), ...Object.keys(afterDerived.setTiers)]);
  const setTierChanges = [...setIds]
    .map((setId) => ({
      setId,
      from: beforeDerived.setTiers[setId] ?? 0,
      to: afterDerived.setTiers[setId] ?? 0,
    }))
    .filter((c) => c.from !== c.to);

  return {
    revision,
    statDeltas: diffStats(beforeDerived.stats, afterDerived.stats),
    skillsGained,
    skillsLost,
    sourcesActivated,
    sourcesDeactivated,
    setTierChanges,
  };
}

function defaultDerive(
  catalog: Catalog,
  inventory: ItemInstance[],
): DeriveFn {
  return (loadout, bannedSlots, baseStats) =>
    evaluate({ catalog, inventory, loadout, bannedSlots, baseStats });
}

/**
 * 发布管线：先完整校验草稿（校验项与两条求值路径完全相同，不因性能优化而减少），
 * 任何 error 都原样拒绝（active 负载与战斗结果不变）；通过后单次原子替换负载并求值，
 * 再产出来源级变化报告。不存在“先逐件脱装再留下半套”的中间状态。
 *
 * deriveFn 仅替换“通过校验后的求值”这一阶段：参照实现逐次全量重算，
 * 增量实现只重算受槽位/标签/档位/基础属性变化影响的规则；两阶段之外没有隐藏工作。
 */
export function publishRevision(args: PublishArgs, deriveFn?: DeriveFn): PublishResult {
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
  const derive = deriveFn ?? defaultDerive(args.catalog, args.inventory);
  const derived = derive(newLoadout, args.bannedSlots, args.baseStats);

  return {
    ok: true,
    diagnostics,
    revision: nextRevision,
    loadout: newLoadout,
    derived,
    changes: buildChangeReport(args.activeDerived, derived, nextRevision),
  };
}

/** 草稿预览：即使存在阻断错误也尽力求值，界面必须同时展示诊断，不得把预览当作战斗依据 */
export function previewDraft(
  args: Omit<PublishArgs, 'active' | 'activeDerived' | 'currentRevision'>,
  deriveFn?: DeriveFn,
): {
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
  const derive = deriveFn ?? defaultDerive(args.catalog, args.inventory);
  const derived = derive(args.draft, args.bannedSlots, args.baseStats);
  return { diagnostics, derived };
}
