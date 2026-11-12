import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/state/store';
import { SLOTS } from '../src/domain/seed';

function reset() {
  const empty = { weapon: null, helm: null, chest: null, gloves: null, boots: null, accessory: null };
  useStore.setState({
    bannedSlots: [],
    alive: true,
    activeLoadout: { ...empty },
    draftLoadout: { ...empty },
    lastChanges: null,
    lastPublishErrors: null,
    history: [],
    revision: 0,
    combatResults: {},
    notices: [],
  });
}

describe('会话层：编辑锁定与原子发布', () => {
  beforeEach(reset);

  it('死亡时槽位编辑与发布都被拒绝，活动方案不变', () => {
    const s = useStore.getState();
    s.kill();
    expect(useStore.getState().alive).toBe(false);

    const before = JSON.stringify(useStore.getState().activeLoadout);
    useStore.getState().assign(SLOTS.HELM, 'u-dhelm');
    expect(JSON.stringify(useStore.getState().draftLoadout.helm)).toBe('null');
    expect(useStore.getState().notices.at(-1)?.kind).toBe('reject');

    useStore.getState().publish();
    expect(JSON.stringify(useStore.getState().activeLoadout)).toBe(before);
    expect(useStore.getState().revision).toBe(0);
    expect(useStore.getState().lastPublishErrors?.some((d) => d.code === 'character-dead')).toBe(true);
  });

  it('封禁槽位拒绝编辑；解封后可编辑，物品全程留在原位', () => {
    const s = useStore.getState();
    s.assign(SLOTS.BOOTS, 'u-dboots');
    s.publish();
    expect(useStore.getState().activeLoadout.boots).toBe('u-dboots');

    useStore.getState().toggleBan(SLOTS.BOOTS);
    const bannedState = useStore.getState();
    expect(bannedState.bannedSlots).toContain(SLOTS.BOOTS);
    expect(bannedState.activeLoadout.boots).toBe('u-dboots');
    expect(bannedState.activeDerived.suppressed[0].uid).toBe('u-dboots');

    bannedState.assign(SLOTS.BOOTS, null);
    expect(useStore.getState().draftLoadout.boots).toBe('u-dboots');

    useStore.getState().toggleBan(SLOTS.BOOTS);
    expect(useStore.getState().activeDerived.suppressed).toHaveLength(0);
    expect(useStore.getState().activeLoadout.boots).toBe('u-dboots');
  });

  it('含阻断错误的草稿无法发布；修复后原子发布，修订号递增', () => {
    const s = useStore.getState();
    s.assign(SLOTS.WEAPON, 'u-grimoire'); // 含失效技能引用
    s.publish();
    expect(useStore.getState().revision).toBe(0);
    expect(useStore.getState().lastPublishErrors?.some((d) => d.code === 'broken-skill-ref')).toBe(true);
    expect(useStore.getState().activeLoadout.weapon).toBeNull();

    s.assign(SLOTS.WEAPON, 'u-dagger');
    s.publish();
    const after = useStore.getState();
    expect(after.revision).toBe(1);
    expect(after.activeLoadout.weapon).toBe('u-dagger');
    expect(after.lastPublishErrors).toBeNull();
    expect(after.history).toHaveLength(1);
  });

  it('重复实例引用给出解释且阻断，不会以半套状态落地', () => {
    const s = useStore.getState();
    s.assign(SLOTS.WEAPON, 'u-sword');
    s.assign(SLOTS.ACCESSORY, 'u-sword');
    expect(useStore.getState().notices.some((n) => n.message.includes('重复引用'))).toBe(true);
    s.publish();
    expect(useStore.getState().revision).toBe(0);
    expect(useStore.getState().activeLoadout.accessory).toBeNull();
  });

  it('战斗只按活动修订存档：发布新修订后同输入重跑产生不同结果', () => {
    const s = useStore.getState();
    s.assign(SLOTS.WEAPON, 'u-dagger');
    s.publish();
    useStore.getState().executeAttack();
    const r1 = useStore.getState().combatResults[1];
    expect(r1).toBeTruthy();

    s.assign(SLOTS.WEAPON, 'u-blade');
    s.assign(SLOTS.HELM, 'u-dhelm');
    s.assign(SLOTS.CHEST, 'u-dchest');
    s.publish();
    useStore.getState().executeAttack();
    const r2 = useStore.getState().combatResults[2];
    expect(r2).toBeTruthy();
    // 同一 seed/turns/element
    expect(JSON.stringify(r2.input)).toEqual(JSON.stringify(r1.input));
    expect(r2.totalDamage).not.toBe(r1.totalDamage);
  });
});
