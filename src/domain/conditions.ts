import type { Condition, StatKey, StatMap } from './types';

export interface ConditionContext {
  baseStats: StatMap;
  setTiers: Record<string, number>;
  activeTags: Set<string>;
}

export function addStats(acc: StatMap, delta: StatMap): void {
  // for-in 避免 Object.entries 的临时数组分配：该函数在发布拼接的热路径上逐规则调用
  for (const k in delta) {
    const key = k as StatKey;
    acc[key] = (acc[key] ?? 0) + delta[key]!;
  }
}

export function describeCondition(cond: Condition): string {
  switch (cond.kind) {
    case 'always':
      return '无条件';
    case 'statAtLeast':
      return `需要 ${cond.stat} >= ${cond.value}`;
    case 'statAtMost':
      return `需要 ${cond.stat} <= ${cond.value}`;
    case 'setTierAtLeast':
      return `需要套装 ${cond.setId} 达到第 ${cond.tier} 档`;
    case 'hasTag':
      return `需要在装物品带标签 ${cond.tag}`;
  }
}

export function evalCondition(
  cond: Condition,
  ctx: ConditionContext,
): { ok: boolean; reason?: string } {
  switch (cond.kind) {
    case 'always':
      return { ok: true };
    case 'statAtLeast': {
      const v = ctx.baseStats[cond.stat] ?? 0;
      return v >= cond.value
        ? { ok: true }
        : { ok: false, reason: `${describeCondition(cond)}，当前为 ${v}` };
    }
    case 'statAtMost': {
      const v = ctx.baseStats[cond.stat] ?? 0;
      return v <= cond.value
        ? { ok: true }
        : { ok: false, reason: `${describeCondition(cond)}，当前为 ${v}` };
    }
    case 'setTierAtLeast': {
      const tier = ctx.setTiers[cond.setId] ?? 0;
      return tier >= cond.tier
        ? { ok: true }
        : { ok: false, reason: `${describeCondition(cond)}，当前为第 ${tier} 档` };
    }
    case 'hasTag':
      return ctx.activeTags.has(cond.tag)
        ? { ok: true }
        : { ok: false, reason: describeCondition(cond) };
  }
}
