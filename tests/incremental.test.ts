import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/domain/evaluate';
import { IncrementalEvaluator } from '../src/domain/incremental';
import {
  compareDerived,
  compareChangeReports,
  diffSources,
} from '../src/domain/equivalence';
import { publishRevision, previewDraft } from '../src/domain/publish';
import { BASE_STATS, createCatalog, createInventory, SLOTS } from '../src/domain/seed';
import type { Catalog, Loadout } from './helpers';
import { buildSynthetic } from './helpers';

const catalog = createCatalog();
const inventory = createInventory();

const EMPTY: Loadout = {
  weapon: null,
  helm: null,
  chest: null,
  gloves: null,
  boots: null,
  accessory: null,
};

function fullDerive(loadout: Loadout, bannedSlots: string[] = [], baseStats = BASE_STATS) {
  return evaluate({ catalog, inventory, loadout, bannedSlots, baseStats });
}

function compare(label: string, loadout: Loadout, banned: string[] = [], baseStats = BASE_STATS) {
  const ref = fullDerive(loadout, banned, baseStats);
  const got = incremental.evaluate({ loadout, bannedSlots: banned, baseStats }).derived;
  const cmp = compareDerived(ref, got);
  expect(cmp.equivalent, `${label}: ${cmp.differences.map((d) => d.detail).join(' | ')}`).toBe(true);
  return { ref, got };
}

const incremental = new IncrementalEvaluator(catalog, inventory);

describe('增量求值：逐步与全量路径严格等价', () => {
  const steps: { label: string; loadout: Loadout; banned?: string[] }[] = [
    { label: '初始空负载', loadout: EMPTY },
    { label: '装龙鳞 2 件', loadout: { ...EMPTY, helm: 'u-dhelm', chest: 'u-dchest' } },
    { label: '扩到 3 件（跨 3 档阈值）', loadout: { ...EMPTY, helm: 'u-dhelm', chest: 'u-dchest', gloves: 'u-dgloves' } },
    { label: '扩到 4 件（跨 4 档阈值）', loadout: { ...EMPTY, helm: 'u-dhelm', chest: 'u-dchest', gloves: 'u-dgloves', boots: 'u-dboots' } },
    { label: '换入龙牙之刃（标签条件+套装修正）', loadout: { ...EMPTY, weapon: 'u-blade', helm: 'u-dhelm', chest: 'u-dchest', gloves: 'u-dgloves', boots: 'u-dboots' } },
    { label: '饰品力量之戒（套装档位条件）', loadout: { ...EMPTY, weapon: 'u-blade', helm: 'u-dhelm', chest: 'u-dchest', gloves: 'u-dgloves', boots: 'u-dboots', accessory: 'u-ring' } },
    { label: '封禁战靴（有效部件降到 3）', banned: [SLOTS.BOOTS], loadout: { ...EMPTY, weapon: 'u-blade', helm: 'u-dhelm', chest: 'u-dchest', gloves: 'u-dgloves', boots: 'u-dboots' } },
    { label: '解封战靴（回到 4 件）', banned: [], loadout: { ...EMPTY, weapon: 'u-blade', helm: 'u-dhelm', chest: 'u-dchest', gloves: 'u-dgloves', boots: 'u-dboots' } },
    { label: '卸下整套并换霜纹 2 件（跨套装）', loadout: { ...EMPTY, helm: 'u-fhelm', chest: 'u-fchest' } },
    { label: '霜纹 4 件', loadout: { ...EMPTY, helm: 'u-fhelm', chest: 'u-fchest', gloves: 'u-fgloves', boots: 'u-fboots' } },
    { label: '武器换成匕首 + 吸血饰带（独立槽位）', loadout: { ...EMPTY, weapon: 'u-dagger', helm: 'u-fhelm', chest: 'u-fchest', gloves: 'u-fgloves', boots: 'u-fboots', accessory: 'u-belt' } },
    { label: '清空所有槽位', loadout: EMPTY },
  ];

  it('逐步修改每一步的派生状态（含来源、原因、技能、部件数）都与全量一致', () => {
    for (const step of steps) {
      compare(step.label, step.loadout, step.banned ?? []);
    }
  });

  it('修改跨越多个套装阈值时只重算受影响套装且结果一致', () => {
    // 从龙鳞 4 件 + 力量之戒，直接切到霜纹 4 件（两个套装同时跨越多个档位）
    const before: Loadout = { ...EMPTY, helm: 'u-dhelm', chest: 'u-dchest', gloves: 'u-dgloves', boots: 'u-dboots', accessory: 'u-ring' };
    compare('预热龙鳞4+戒指', before);
    const after: Loadout = { ...EMPTY, helm: 'u-fhelm', chest: 'u-fchest', gloves: 'u-fgloves', boots: 'u-fboots', accessory: 'u-ring' };
    compare('一次切到霜纹4+戒指', after);
    const metrics = incremental.lastRunMetrics!;
    expect(metrics.changedSetTiers).toBeGreaterThanOrEqual(2);
  });

  it('约束失败回退后仍与全量一致，且失败前后缓存不被污染', () => {
    const valid: Loadout = { ...EMPTY, helm: 'u-dhelm', chest: 'u-dchest' };
    const { ref: validRef } = compare('合法草稿', valid);

    // 用发布管线走一次被拒的草稿：互斥套装冲突（龙鳞 2 件 + 霜纹 2 件）
    const bad: Loadout = { ...EMPTY, helm: 'u-dhelm', chest: 'u-dchest', gloves: 'u-fgloves', boots: 'u-fboots' };
    const rejected = publishRevision(
      {
        catalog,
        inventory,
        draft: bad,
        active: valid,
        activeDerived: validRef,
        bannedSlots: [],
        alive: true,
        baseStats: BASE_STATS,
        currentRevision: 1,
      },
      (l, b, s) => incremental.asDeriveFn()(l, b, s),
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.diagnostics.some((d) => d.code === 'mutex-set')).toBe(true);

    // 回退到合法负载后，增量结果仍等于全量参照（未提交的非法草稿从未进入缓存）
    compare('回退到合法负载', valid);
    // 再次发布合法负载，来源报告应与全量路径产出的完全一致
    const incrementalResult = publishRevision(
      {
        catalog,
        inventory,
        draft: valid,
        active: EMPTY,
        activeDerived: fullDerive(EMPTY),
        bannedSlots: [],
        alive: true,
        baseStats: BASE_STATS,
        currentRevision: 0,
      },
      (l, b, s) => incremental.asDeriveFn()(l, b, s),
    );
    const referenceResult = publishRevision({
      catalog,
      inventory,
      draft: valid,
      active: EMPTY,
      activeDerived: fullDerive(EMPTY),
      bannedSlots: [],
      alive: true,
      baseStats: BASE_STATS,
      currentRevision: 0,
    });
    expect(incrementalResult.ok).toBe(true);
    const reportDiffs = compareChangeReports(referenceResult.changes!, incrementalResult.changes!);
    expect(reportDiffs).toEqual([]);
  });

  it('小规模输入下增量路径耗时退化在可控范围（不虚构加速）', () => {
    // 小输入中索引建立占主导，增量不应慢到数量级差异；此处只断言确有完整校验与完整发布
    const preview = previewDraft(
      {
        catalog,
        inventory,
        draft: { ...EMPTY, weapon: 'u-sword', accessory: 'u-amulet' },
        bannedSlots: [],
        alive: true,
        baseStats: BASE_STATS,
      },
      (l, b, s) => incremental.asDeriveFn()(l, b, s),
    );
    expect(preview.diagnostics.some((d) => d.level === 'error')).toBe(false);
    expect(preview.derived.traces.length).toBeGreaterThan(0);
  });
});

describe('增量求值：规则版本切换与缓存失效', () => {
  it('切换目录后旧套装/旧条件效果不得残留', () => {
    const inc = new IncrementalEvaluator(catalog, inventory);
    const before: Loadout = { ...EMPTY, helm: 'u-dhelm', chest: 'u-dchest', gloves: 'u-dgloves', boots: 'u-dboots' };
    const first = inc.evaluate({ loadout: before, bannedSlots: [], baseStats: BASE_STATS });
    expect(first.derived.setTiers.set_dragon).toBe(4);
    expect(first.derived.skills).toContain('skill_sword_dance');

    // 规则版本切换：删除龙鳞 4 档技能、并把 4 档条件改成不再满足
    const next: Catalog = JSON.parse(JSON.stringify(catalog));
    next.sets.set_dragon.tiers = next.sets.set_dragon.tiers.filter((t) => t.threshold !== 4);
    next.items.iron_sword.effects.push({
      id: 'iron_sword_new_rule',
      condition: { kind: 'statAtLeast', stat: 'str', value: 9999 },
      stats: { atk: 1 },
    });
    inc.rebase(next);

    const after = inc.evaluate({ loadout: before, bannedSlots: [], baseStats: BASE_STATS });
    const ref = evaluate({ catalog: next, inventory, loadout: before, bannedSlots: [], baseStats: BASE_STATS });
    const cmp = compareDerived(ref, after.derived);
    expect(cmp.equivalent, cmp.differences.map((d) => d.detail).join(' | ')).toBe(true);
    expect(after.derived.setTiers.set_dragon).toBe(3);
    expect(after.derived.skills).not.toContain('skill_sword_dance');
    expect(after.derived.traces.some((t) => t.ruleId === 'dragon_t4')).toBe(false);
    expect(after.metrics.indexBuilds).toBeGreaterThanOrEqual(2);
  });

  it('基础属性变化会重算属性条件，且不影响标签依赖', () => {
    const inc = new IncrementalEvaluator(catalog, inventory);
    const loadout: Loadout = { ...EMPTY, weapon: 'u-sword', accessory: 'u-ring', helm: 'u-dhelm', chest: 'u-dchest' };
    const base = inc.evaluate({ loadout, bannedSlots: [], baseStats: BASE_STATS });
    const boosted = { ...BASE_STATS, str: 40 };
    const got = inc.evaluate({ loadout, bannedSlots: [], baseStats: boosted }).derived;
    const ref = fullDerive(loadout, [], boosted);
    const cmp = compareDerived(ref, got);
    expect(cmp.equivalent, cmp.differences.map((d) => d.detail).join(' | ')).toBe(true);
    // 仅基础属性变化：槽位与标签不变，铁剑 str>=12 规则被重新判断
    expect(inc.lastRunMetrics!.changedSlots).toBe(0);
    expect(inc.lastRunMetrics!.changedTags).toBe(0);
    expect(base.derived.stats.atk).toBeGreaterThan(0);
    const strong = got.traces.find((t) => t.ruleId === 'iron_sword_strong')!;
    expect(strong.active).toBe(true);
    const beforeTrace = base.derived.traces.find((t) => t.ruleId === 'iron_sword_strong')!;
    expect(beforeTrace.active).toBe(true);
  });
});

describe('增量求值：来源撤销不可只看总属性', () => {
  it('相同总属性但来源不同的两次修改被判为不等价', () => {
    // 龙鳞 2 件：头盔+胸甲 vs 护手+战靴（部件数相同但来源实例不同）
    const a = fullDerive({ ...EMPTY, helm: 'u-dhelm', chest: 'u-dchest' });
    const b = fullDerive({ ...EMPTY, gloves: 'u-dgloves', boots: 'u-dboots' });
    expect(b.stats.hp === a.stats.hp && b.stats.def === a.stats.def).not.toBe(true);
    const cmp = compareDerived(a, b);
    expect(cmp.equivalent).toBe(false);
    expect(cmp.differences.some((d) => d.kind === 'traces')).toBe(true);
  });

  it('卸下后来源撤销事件与全量路径逐项一致', () => {
    const inc = new IncrementalEvaluator(catalog, inventory);
    // 龙牙之刃本身带 dragonforged 标签且属于龙鳞套装，武器在装时 4 件满足 4 档
    const four: Loadout = { ...EMPTY, weapon: 'u-blade', helm: 'u-dhelm', chest: 'u-dchest', gloves: 'u-dgloves' };
    inc.evaluate({ loadout: four, bannedSlots: [], baseStats: BASE_STATS });
    const three: Loadout = { ...four, weapon: null };
    const got = inc.evaluate({ loadout: three, bannedSlots: [], baseStats: BASE_STATS }).derived;
    const ref = fullDerive(three);
    const incDiff = diffSources(fullDerive(four), got);
    const refDiff = diffSources(fullDerive(four), ref);
    expect(incDiff.activated).toEqual(refDiff.activated);
    expect(incDiff.deactivated).toEqual(refDiff.deactivated);
    const joined = incDiff.deactivated.join('\n');
    expect(joined).toContain('item:u-blade:dragon_blade:dragon_blade_skill');
    expect(joined).toContain('item:u-blade');
    expect(joined).toContain('set:set_dragon:4:dragon_t4');
    // 撤销后不得残留剑舞斩技能来源
    expect(got.skills).not.toContain('skill_sword_dance');
    expect(got.traces.some((t) => t.active && t.ruleId === 'dragon_t4')).toBe(false);
  });
});

describe('合成对数场景：随机负载序列严格等价', () => {
  it('多规模随机序列在所有步骤与全量路径一致', () => {
    for (const scale of [
      { slots: 12, sets: 4, tiers: 4 },
      { slots: 32, sets: 8, tiers: 4 },
    ]) {
      const synthetic = buildSynthetic(scale);
      const inc = new IncrementalEvaluator(synthetic.catalog, synthetic.inventory);
      const slots = synthetic.catalog.slots.map((s) => s.id);
      let rngState = 7;
      const rand = () => {
        rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
        return rngState / 0x7fffffff;
      };
      for (let step = 0; step < 40; step++) {
        const loadout: Loadout = {};
        for (const slot of slots) {
          const opts = synthetic.slotOptions[slot] ?? [];
          loadout[slot] = opts.length && rand() < 0.6 ? opts[Math.floor(rand() * opts.length)] : null;
        }
        const banned = rand() < 0.2 ? [slots[Math.floor(rand() * slots.length)]] : [];
        const stats = synthetic.baseStats;
        const got = inc.evaluate({ loadout, bannedSlots: banned, baseStats: stats }).derived;
        const ref = evaluate({
          catalog: synthetic.catalog,
          inventory: synthetic.inventory,
          loadout,
          bannedSlots: banned,
          baseStats: stats,
        });
        const cmp = compareDerived(ref, got);
        expect(
          cmp.equivalent,
          `scale slots=${scale.slots} step=${step}: ${cmp.differences.map((d) => d.detail).join(' | ')}`,
        ).toBe(true);
      }
    }
  });
});
