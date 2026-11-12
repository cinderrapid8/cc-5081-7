import type { DerivedState, EffectSource, EffectTrace, StatMap } from './types';
import type { ChangeReport } from './publish';

export interface DerivedDifference {
  kind:
    | 'stats'
    | 'skills'
    | 'setTiers'
    | 'setPieceCounts'
    | 'suppressed'
    | 'traces'
    | 'unresolvedSkills';
  detail: string;
}

export interface EquivalenceReport {
  equivalent: boolean;
  differences: DerivedDifference[];
}

function normalizeStats(stats: StatMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(stats)) {
    if (v) out[k] = v;
  }
  return out;
}

export function traceIdentity(t: EffectTrace): string {
  const source: EffectSource = t.source;
  return source.kind === 'item'
    ? `item:${source.uid}:${source.itemId}:${t.ruleId}`
    : `set:${source.setId}:${source.threshold}:${t.ruleId}`;
}

export function traceStateIdentity(t: EffectTrace): string {
  return `${traceIdentity(t)}|${t.active ? 'active' : 'inactive'}|${t.active ? '' : t.inactiveReason ?? ''}`;
}

function sameStats(a: StatMap, b: StatMap): boolean {
  const na = normalizeStats(a);
  const nb = normalizeStats(b);
  const keys = new Set([...Object.keys(na), ...Object.keys(nb)]);
  for (const k of keys) if ((na[k] ?? 0) !== (nb[k] ?? 0)) return false;
  return true;
}

function sameArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * 两条求值路径的严格等价比较：不仅比较总属性，还逐规则比较来源身份、
 * 激活状态与未激活原因，并比较技能、套装档位、有效部件数、封禁解释与失效引用。
 * 来源身份包含实例 uid / 套装档位，因此“总属性相同但来源关系错误”会被判为不等价。
 */
function canonicalRecord(rec: Record<string, number>): string {
  return Object.keys(rec)
    .sort()
    .map((k) => `${k}=${rec[k]}`)
    .join(',');
}

export function compareDerived(reference: DerivedState, candidate: DerivedState): EquivalenceReport {
  const differences: DerivedDifference[] = [];

  if (!sameStats(reference.stats, candidate.stats)) {
    differences.push({
      kind: 'stats',
      detail: `属性不一致：ref=${JSON.stringify(normalizeStats(reference.stats))} got=${JSON.stringify(
        normalizeStats(candidate.stats),
      )}`,
    });
  }
  if (!sameArray(reference.skills, candidate.skills)) {
    differences.push({
      kind: 'skills',
      detail: `技能列表不一致：ref=[${reference.skills.join(',')}] got=[${candidate.skills.join(',')}]`,
    });
  }
  if (!sameArray(reference.skills.slice().sort(), candidate.skills.slice().sort())) {
    differences.push({
      kind: 'skills',
      detail: `技能集合不一致：ref=[${reference.skills.slice().sort().join(',')}] got=[${candidate.skills
        .slice()
        .sort()
        .join(',')}]`,
    });
  }
  if (canonicalRecord(reference.setTiers) !== canonicalRecord(candidate.setTiers)) {
    differences.push({
      kind: 'setTiers',
      detail: `套装档位不一致：ref=${JSON.stringify(reference.setTiers)} got=${JSON.stringify(
        candidate.setTiers,
      )}`,
    });
  }
  if (canonicalRecord(reference.setPieceCounts) !== canonicalRecord(candidate.setPieceCounts)) {
    differences.push({
      kind: 'setPieceCounts',
      detail: `有效部件数不一致：ref=${JSON.stringify(reference.setPieceCounts)} got=${JSON.stringify(
        candidate.setPieceCounts,
      )}`,
    });
  }
  if (JSON.stringify(reference.suppressed) !== JSON.stringify(candidate.suppressed)) {
    differences.push({
      kind: 'suppressed',
      detail: `封禁惰性物品不一致：ref=${JSON.stringify(reference.suppressed)} got=${JSON.stringify(
        candidate.suppressed,
      )}`,
    });
  }

  if (reference.traces.length !== candidate.traces.length) {
    differences.push({
      kind: 'traces',
      detail: `规则 trace 数量不一致：ref=${reference.traces.length} got=${candidate.traces.length}`,
    });
  }
  const len = Math.max(reference.traces.length, candidate.traces.length);
  for (let i = 0; i < len; i++) {
    const r = reference.traces[i];
    const c = candidate.traces[i];
    if (!r || !c) {
      differences.push({ kind: 'traces', detail: `位置 ${i} 缺少 trace：ref=${Boolean(r)} got=${Boolean(c)}` });
      continue;
    }
    if (traceIdentity(r) !== traceIdentity(c)) {
      differences.push({
        kind: 'traces',
        detail: `位置 ${i} 来源/规则不一致：ref=${traceIdentity(r)} got=${traceIdentity(c)}`,
      });
    } else if (r.active !== c.active) {
      differences.push({
        kind: 'traces',
        detail: `位置 ${i} 激活状态不一致：${traceIdentity(r)} ref=${r.active} got=${c.active}`,
      });
    } else if (!r.active && (r.inactiveReason ?? '') !== (c.inactiveReason ?? '')) {
      differences.push({
        kind: 'traces',
        detail: `位置 ${i} 未激活原因不一致：${traceIdentity(r)} ref=${r.inactiveReason} got=${c.inactiveReason}`,
      });
    } else if (r.active && (!sameStatsOf(r.stats, c.stats) || !sameArray(r.skills, c.skills))) {
      differences.push({
        kind: 'traces',
        detail: `位置 ${i} 激活输出不一致：${traceIdentity(r)}`,
      });
    }
  }

  if (JSON.stringify(reference.unresolvedSkills) !== JSON.stringify(candidate.unresolvedSkills)) {
    differences.push({
      kind: 'unresolvedSkills',
      detail: `失效技能引用不一致：ref=${JSON.stringify(reference.unresolvedSkills)} got=${JSON.stringify(
        candidate.unresolvedSkills,
      )}`,
    });
  }

  return { equivalent: differences.length === 0, differences };
}

function sameStatsOf(a: StatMap, b: StatMap): boolean {
  return sameStats(a, b);
}

/**
 * 对比两次发布报告的能力级差异：激活/撤销来源与技能增减必须逐项一致，
 * 不能只靠总属性差值宣称等价。返回差异列表（空表示报告等价）。
 */
export function compareChangeReports(reference: ChangeReport, candidate: ChangeReport): string[] {
  const out: string[] = [];
  const cmpList = (label: string, a: string[], b: string[]) => {
    const sa = a.slice().sort().join('\n');
    const sb = b.slice().sort().join('\n');
    if (sa !== sb) out.push(`${label}不一致：ref=[${a.join(', ')}] got=[${b.join(', ')}]`);
  };
  cmpList('激活来源', reference.sourcesActivated, candidate.sourcesActivated);
  cmpList('撤销来源', reference.sourcesDeactivated, candidate.sourcesDeactivated);
  cmpList('获得技能', reference.skillsGained, candidate.skillsGained);
  cmpList('撤销技能', reference.skillsLost, candidate.skillsLost);
  const setA = reference.setTierChanges
    .map((c) => `${c.setId}:${c.from}->${c.to}`)
    .sort()
    .join(',');
  const setB = candidate.setTierChanges
    .map((c) => `${c.setId}:${c.from}->${c.to}`)
    .sort()
    .join(',');
  if (setA !== setB) out.push(`套装档位变化不一致：ref=[${setA}] got=[${setB}]`);
  if (!sameStats(reference.statDeltas, candidate.statDeltas)) {
    out.push('属性差值不一致');
  }
  return out;
}

/** 计算两个派生状态之间的来源级激活/撤销集合，用于验证多次修改后的累计撤销是否正确 */
export function diffSources(before: DerivedState, after: DerivedState): {
  activated: string[];
  deactivated: string[];
} {
  const beforeActive = new Set(before.traces.filter((t) => t.active).map(traceIdentity));
  const afterActive = new Set(after.traces.filter((t) => t.active).map(traceIdentity));
  return {
    activated: [...afterActive].filter((k) => !beforeActive.has(k)),
    deactivated: [...beforeActive].filter((k) => !afterActive.has(k)),
  };
}
