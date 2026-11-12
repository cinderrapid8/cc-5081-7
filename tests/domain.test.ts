import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/domain/evaluate';
import { publishRevision } from '../src/domain/publish';
import { runCombat } from '../src/domain/combat';
import { BASE_STATS, DUMMY, createCatalog, createInventory, SLOTS } from '../src/domain/seed';
import { validate } from '../src/domain/validate';
import type { Loadout } from '../src/domain/types';

const catalog = createCatalog();
const inventory = createInventory();
const emptyLoadout: Loadout = {
  weapon: null,
  helm: null,
  chest: null,
  gloves: null,
  boots: null,
  accessory: null,
};

function derive(loadout: Loadout, bannedSlots: string[] = []) {
  return evaluate({ catalog, inventory, loadout, bannedSlots, baseStats: BASE_STATS });
}

function publish(draft: Loadout, opts: { bannedSlots?: string[]; alive?: boolean } = {}) {
  const emptyDerived = derive(emptyLoadout);
  return publishRevision({
    catalog,
    inventory,
    draft,
    active: emptyLoadout,
    activeDerived: emptyDerived,
    bannedSlots: opts.bannedSlots ?? [],
    alive: opts.alive ?? true,
    baseStats: BASE_STATS,
    currentRevision: 0,
  });
}

const dragon4: Loadout = {
  ...emptyLoadout,
  helm: 'u-dhelm',
  chest: 'u-dchest',
  gloves: 'u-dgloves',
  boots: 'u-dboots',
};

describe('槽位兼容与重复实例引用', () => {
  it('拒绝把武器物品放入不兼容槽位', () => {
    const loadout: Loadout = { ...emptyLoadout, boots: 'u-sword' };
    const diags = validate({ catalog, inventory, loadout, bannedSlots: [], alive: true });
    expect(diags.some((d) => d.code === 'slot-incompatible')).toBe(true);
    expect(publish(loadout).ok).toBe(false);
  });

  it('同一物品实例被两个槽位重复引用时阻断并给出两处位置', () => {
    const loadout: Loadout = { ...emptyLoadout, weapon: 'u-sword', accessory: 'u-sword' };
    const diags = validate({ catalog, inventory, loadout, bannedSlots: [], alive: true });
    const dup = diags.filter((d) => d.code === 'duplicate-instance');
    expect(dup.length).toBe(1);
    expect(dup[0].message).toContain('weapon');
    expect(dup[0].message).toContain('accessory');
    expect(publish(loadout).ok).toBe(false);
  });

  it('引用背包中不存在的实例时阻断', () => {
    const loadout: Loadout = { ...emptyLoadout, weapon: 'u-ghost' };
    const diags = validate({ catalog, inventory, loadout, bannedSlots: [], alive: true });
    expect(diags.some((d) => d.code === 'unknown-instance')).toBe(true);
  });
});

describe('互斥标签与互斥套装', () => {
  it('共享互斥标签的两件在装物品冲突（跨槽位）', () => {
    // 诅咒魔导书与吸血饰带都带 cursed 标签，分别在武器槽与饰品槽
    const loadout: Loadout = { ...emptyLoadout, weapon: 'u-grimoire', accessory: 'u-belt' };
    const diags = validate({ catalog, inventory, loadout, bannedSlots: [], alive: true });
    const tag = diags.find((d) => d.code === 'mutex-tag');
    expect(tag).toBeTruthy();
    expect(tag!.related!.tag).toBe('cursed');
    expect(publish(loadout).ok).toBe(false);
  });

  it('同一互斥组的两套套装不能同时激活', () => {
    const loadout: Loadout = {
      ...emptyLoadout,
      helm: 'u-dhelm',
      chest: 'u-dchest',
      gloves: 'u-fgloves',
      boots: 'u-fboots',
    };
    const diags = validate({ catalog, inventory, loadout, bannedSlots: [], alive: true });
    const mutex = diags.filter((d) => d.code === 'mutex-set');
    expect(mutex.length).toBe(2);
    expect(publish(loadout).ok).toBe(false);
  });

  it('单套达到 2/3/4 件时按累计档位激活', () => {
    const two: Loadout = { ...emptyLoadout, helm: 'u-dhelm', chest: 'u-dchest' };
    expect(derive(two).setTiers.set_dragon).toBe(2);
    const three: Loadout = { ...two, gloves: 'u-dgloves' };
    expect(derive(three).setTiers.set_dragon).toBe(3);
    expect(derive(dragon4).setTiers.set_dragon).toBe(4);

    const d = derive(dragon4);
    // 4 件时 t2/t3/t4 三档全部处于激活
    const setTraces = d.traces.filter((t) => t.source.kind === 'set' && t.active);
    expect(setTraces.map((t) => (t.source as { threshold: number }).threshold).sort()).toEqual([2, 3, 4]);
    expect(d.skills).toContain('skill_sword_dance');
  });
});

describe('阈值上下反复切换与来源撤销', () => {
  it('在 2/3/4 件之间反复增减，激活效果与撤销始终一致', () => {
    let loadout: Loadout = { ...emptyLoadout, helm: 'u-dhelm', chest: 'u-dchest' };
    const sequence: { next: Loadout; tier: number }[] = [
      { next: { ...loadout, gloves: 'u-dgloves' }, tier: 3 },
      { next: { ...loadout, gloves: 'u-dgloves', boots: 'u-dboots' }, tier: 4 },
      { next: { ...loadout, gloves: 'u-dgloves' }, tier: 3 },
      { next: loadout, tier: 2 },
      { next: { ...loadout, gloves: 'u-dgloves', boots: 'u-dboots' }, tier: 4 },
      { next: loadout, tier: 2 },
    ];
    for (const step of sequence) {
      const d = derive(step.next);
      expect(d.setTiers.set_dragon ?? 0).toBe(step.tier);
      const activeSetRules = d.traces.filter(
        (t) => t.source.kind === 'set' && (t.source as { setId: string }).setId === 'set_dragon' && t.active,
      );
      const expectedCount = step.tier === 2 ? 1 : step.tier === 3 ? 2 : 3;
      expect(activeSetRules.length).toBe(expectedCount);
      // 未激活档位必须可解释
      const inactive = d.traces.find(
        (t) => t.source.kind === 'set' && !t.active,
      );
      if (step.tier < 4) expect(inactive?.inactiveReason).toContain('未达');
    }
  });

  it('替换触发阈值变化时，发布报告给出激活/撤销来源与属性差', () => {
    const three: Loadout = { ...emptyLoadout, helm: 'u-dhelm', chest: 'u-dchest', gloves: 'u-dgloves' };
    const base = publish(three);
    expect(base.ok).toBe(true);
    const result = publishRevision({
      catalog,
      inventory,
      draft: dragon4,
      active: three,
      activeDerived: base.derived!,
      bannedSlots: [],
      alive: true,
      baseStats: BASE_STATS,
      currentRevision: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.changes!.setTierChanges).toContainEqual({ setId: 'set_dragon', from: 3, to: 4 });
    expect(result.changes!.sourcesActivated.join()).toContain('dragon_t4');
    // 降回 3 件时 t4 来源必须被撤销
    const back = publishRevision({
      catalog,
      inventory,
      draft: three,
      active: dragon4,
      activeDerived: result.derived!,
      bannedSlots: [],
      alive: true,
      baseStats: BASE_STATS,
      currentRevision: 2,
    });
    expect(back.changes!.sourcesDeactivated.join()).toContain('dragon_t4');
    expect(back.derived!.skills).not.toContain('skill_sword_dance');
  });

  it('条件效果随条件失效而撤销（力量之戒的套装条件）', () => {
    const ring: Loadout = { ...emptyLoadout, accessory: 'u-ring' };
    const noSet = derive(ring);
    expect(noSet.stats.atk).toBeUndefined();
    const withSet = derive({ ...ring, helm: 'u-dhelm', chest: 'u-dchest' });
    // 力量之戒条件 +10，龙鳞 2 件档 t2 再 +5
    expect(withSet.stats.atk).toBe(15);
    const trace = withSet.traces.find((t) => t.ruleId === 'power_ring_dragon')!;
    expect(trace.active).toBe(true);
    expect(noSet.traces.find((t) => t.ruleId === 'power_ring_dragon')!.active).toBe(false);
  });
});

describe('临时封禁槽位', () => {
  it('封禁槽位中的物品不计属性、不计套装部件、不提供技能，且有一致解释', () => {
    const banned = [SLOTS.BOOTS];
    const d = derive(dragon4, banned);
    // 靴子被封禁：有效部件 3，档位从 4 降到 3
    expect(d.setPieceCounts.set_dragon).toBe(3);
    expect(d.setTiers.set_dragon).toBe(3);
    expect(d.suppressed).toHaveLength(1);
    expect(d.suppressed[0].slot).toBe(SLOTS.BOOTS);
    const bootTraces = d.traces.filter(
      (t) => t.source.kind === 'item' && (t.source as { uid: string }).uid === 'u-dboots',
    );
    expect(bootTraces.every((t) => !t.active)).toBe(true);
    expect(bootTraces[0].inactiveReason).toContain('封禁');
    // t4 技能随之失效
    expect(d.skills).not.toContain('skill_sword_dance');

    const diags = validate({ catalog, inventory, loadout: dragon4, bannedSlots: banned, alive: true });
    expect(diags.some((d) => d.code === 'slot-banned' && d.level === 'warning')).toBe(true);
    // warning 不阻断发布
    expect(publish(dragon4, { bannedSlots: banned }).ok).toBe(true);
  });

  it('解封后状态与从未封禁一致（无半套残留）', () => {
    const banned = derive(dragon4, [SLOTS.BOOTS]);
    const restored = derive(dragon4, []);
    expect(restored.setTiers.set_dragon).toBe(4);
    expect(restored.traces.filter((t) => t.active).length).toBeGreaterThan(
      banned.traces.filter((t) => t.active).length,
    );
    expect(restored.traces.every((t) => t.active || t.inactiveReason?.includes('条件') === false)).toBe(true);
  });
});

describe('失效技能引用定位', () => {
  it('装备含失效引用的物品时，错误定位到物品/规则/技能并阻断发布', () => {
    const loadout: Loadout = { ...emptyLoadout, weapon: 'u-grimoire' };
    const diags = validate({ catalog, inventory, loadout, bannedSlots: [], alive: true });
    const broken = diags.filter((d) => d.code === 'broken-skill-ref');
    expect(broken).toHaveLength(1);
    expect(broken[0].related!.skillId).toBe('skill_lost_spell');
    expect(broken[0].related!.effectId).toBe('grimoire_broken_ref');
    expect(broken[0].related!.itemId).toBe('cursed_grimoire');
    expect(publish(loadout).ok).toBe(false);
  });

  it('未在装的物品即使含失效引用也不报错', () => {
    const diags = validate({ catalog, inventory, loadout: emptyLoadout, bannedSlots: [], alive: true });
    expect(diags.some((d) => d.code === 'broken-skill-ref')).toBe(false);
  });
});

describe('角色死亡时换装', () => {
  it('死亡状态下任何修订都不能发布', () => {
    const result = publish({ ...emptyLoadout, weapon: 'u-dagger' }, { alive: false });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'character-dead')).toBe(true);
  });
});

describe('战斗假人与同输入对比', () => {
  const input = { seed: 42, turns: 6, element: 'physical' as const };

  it('相同负载与输入产生完全相同的战斗结果（确定性）', () => {
    const d = derive(dragon4);
    const a = runCombat({ baseStats: BASE_STATS, derived: d, revision: 1, skills: catalog.skills }, DUMMY, input);
    const b = runCombat({ baseStats: BASE_STATS, derived: d, revision: 1, skills: catalog.skills }, DUMMY, input);
    expect(JSON.parse(JSON.stringify(a.logs))).toEqual(JSON.parse(JSON.stringify(b.logs)));
  });

  it('不同负载在同一攻击输入下产生可比较的真实差异', () => {
    const weak = derive({ ...emptyLoadout, weapon: 'u-dagger' });
    const strong = derive({ ...dragon4, weapon: 'u-blade' });
    const weakResult = runCombat({ baseStats: BASE_STATS, derived: weak, revision: 1, skills: catalog.skills }, DUMMY, input);
    const strongResult = runCombat({ baseStats: BASE_STATS, derived: strong, revision: 2, skills: catalog.skills }, DUMMY, input);
    expect(strongResult.totalDamage).toBeGreaterThan(weakResult.totalDamage);
    // 龙套 4 件的剑舞斩必须出现在技能来源里
    expect(strongResult.logs.some((l) => l.appliedSkills.includes('skill_sword_dance'))).toBe(true);
    expect(weakResult.logs.every((l) => !l.appliedSkills.includes('skill_sword_dance'))).toBe(true);
  });

  it('只有已发布负载影响战斗：被拒绝的草稿不改变结果', () => {
    const active = derive({ ...emptyLoadout, weapon: 'u-sword' });
    const result = runCombat({ baseStats: BASE_STATS, derived: active, revision: 0, skills: catalog.skills }, DUMMY, input);
    // 非法草稿（重复实例）发布失败，活动派生状态不变 -> 同输入同结果
    const bad: Loadout = { ...emptyLoadout, weapon: 'u-sword', accessory: 'u-sword' };
    expect(publish(bad).ok).toBe(false);
    const again = runCombat({ baseStats: BASE_STATS, derived: active, revision: 0, skills: catalog.skills }, DUMMY, input);
    expect(again.totalDamage).toBe(result.totalDamage);
  });
});
