import { create } from 'zustand';
import { evaluate } from '../domain/evaluate';
import { previewDraft, publishRevision, type ChangeReport } from '../domain/publish';
import { runCombat, type AttackInput, type CombatResult } from '../domain/combat';
import { BASE_STATS, DUMMY, createCatalog, createInventory, SLOTS } from '../domain/seed';
import type {
  Catalog,
  DerivedState,
  Diagnostic,
  ItemInstance,
  Loadout,
  StatMap,
} from '../domain/types';

interface SessionNotice {
  id: number;
  kind: 'info' | 'reject';
  message: string;
}

interface StoreState {
  catalog: Catalog;
  inventory: ItemInstance[];
  baseStats: StatMap;
  bannedSlots: string[];
  alive: boolean;

  activeLoadout: Loadout;
  activeDerived: DerivedState;
  revision: number;

  draftLoadout: Loadout;
  draftDiagnostics: Diagnostic[];
  draftDerived: DerivedState;

  lastChanges: ChangeReport | null;
  lastPublishErrors: Diagnostic[] | null;
  history: { revision: number; changes: ChangeReport }[];
  notices: SessionNotice[];

  attackInput: AttackInput;
  combatResults: Record<number, CombatResult>;

  assign: (slot: string, uid: string | null) => void;
  reassignMove: (slot: string, uid: string) => void;
  clearSlot: (slot: string) => void;
  resetDraft: () => void;
  publish: () => void;
  toggleBan: (slot: string) => void;
  kill: () => void;
  revive: () => void;
  setAttackInput: (patch: Partial<AttackInput>) => void;
  executeAttack: () => void;
  dismissNotice: (id: number) => void;
}

const catalog = createCatalog();
const inventory = createInventory();

const initialLoadout: Loadout = {
  [SLOTS.WEAPON]: 'u-sword',
  [SLOTS.HELM]: null,
  [SLOTS.CHEST]: null,
  [SLOTS.GLOVES]: null,
  [SLOTS.BOOTS]: null,
  [SLOTS.ACCESSORY]: 'u-amulet',
};

function derive(loadout: Loadout, bannedSlots: string[]): DerivedState {
  return evaluate({ catalog, inventory, loadout, bannedSlots, baseStats: BASE_STATS });
}

let noticeSeq = 0;

export const useStore = create<StoreState>((set, get) => {
  const refreshPreview = (draftLoadout: Loadout, bannedSlots: string[], alive: boolean) => {
    const { diagnostics, derived } = previewDraft({
      catalog,
      inventory,
      draft: draftLoadout,
      bannedSlots,
      alive,
      baseStats: BASE_STATS,
    });
    return { draftDiagnostics: diagnostics, draftDerived: derived };
  };

  const pushNotice = (notice: Omit<SessionNotice, 'id'>) => {
    const id = ++noticeSeq;
    set((s) => ({ notices: [...s.notices, { ...notice, id }] }));
  };

  return {
    catalog,
    inventory,
    baseStats: BASE_STATS,
    bannedSlots: [],
    alive: true,

    activeLoadout: initialLoadout,
    activeDerived: derive(initialLoadout, []),
    revision: 0,

    draftLoadout: { ...initialLoadout },
    draftDiagnostics: [],
    draftDerived: derive(initialLoadout, []),

    lastChanges: null,
    lastPublishErrors: null,
    history: [],
    notices: [],

    attackInput: { seed: 20261112, turns: 6, element: 'physical' },
    combatResults: {},

    assign: (slot, uid) => {
      const s = get();
      if (!s.alive) {
        pushNotice({ kind: 'reject', message: `角色已死亡，槽位「${slot}」的编辑被拒绝；请先复活` });
        return;
      }
      if (s.bannedSlots.includes(slot)) {
        pushNotice({ kind: 'reject', message: `槽位「${slot}」处于临时封禁，编辑被拒绝；物品保持原位且完全失效` });
        return;
      }
      const draft = { ...s.draftLoadout, [slot]: uid };
      if (uid) {
        const otherSlot = Object.entries(draft).find(([sl, u]) => sl !== slot && u === uid);
        if (otherSlot) {
          pushNotice({
            kind: 'info',
            message: `实例 ${uid} 同时出现在槽位「${otherSlot[0]}」与「${slot}」，构成重复引用；发布校验会阻断，需清除其一`,
          });
        }
      }
      set({ draftLoadout: draft, ...refreshPreview(draft, s.bannedSlots, s.alive) });
    },

    reassignMove: (slot, uid) => {
      const s = get();
      if (!s.alive || s.bannedSlots.includes(slot)) {
        pushNotice({ kind: 'reject', message: '当前状态不允许编辑该槽位（死亡或封禁）' });
        return;
      }
      const draft: Loadout = { ...s.draftLoadout };
      for (const [sl, u] of Object.entries(draft)) {
        if (u === uid) draft[sl] = null;
      }
      draft[slot] = uid;
      set({ draftLoadout: draft, ...refreshPreview(draft, s.bannedSlots, s.alive) });
    },

    clearSlot: (slot) => get().assign(slot, null),

    resetDraft: () => {
      const s = get();
      set({
        draftLoadout: { ...s.activeLoadout },
        ...refreshPreview({ ...s.activeLoadout }, s.bannedSlots, s.alive),
        lastPublishErrors: null,
      });
    },

    publish: () => {
      const s = get();
      const result = publishRevision({
        catalog: s.catalog,
        inventory: s.inventory,
        draft: s.draftLoadout,
        active: s.activeLoadout,
        activeDerived: s.activeDerived,
        bannedSlots: s.bannedSlots,
        alive: s.alive,
        baseStats: s.baseStats,
        currentRevision: s.revision,
      });

      if (!result.ok || !result.loadout || !result.derived || !result.changes) {
        set({ lastPublishErrors: result.diagnostics });
        pushNotice({
          kind: 'reject',
          message: `发布被拒绝：${result.diagnostics.filter((d) => d.level === 'error').length} 个阻断性错误，活动负载与战斗结果保持不变`,
        });
        return;
      }

      set({
        activeLoadout: result.loadout,
        activeDerived: result.derived,
        revision: result.revision!,
        draftLoadout: { ...result.loadout },
        draftDerived: result.derived,
        draftDiagnostics: result.diagnostics,
        lastChanges: result.changes,
        lastPublishErrors: null,
        history: [...s.history, { revision: result.revision!, changes: result.changes }],
      });
      pushNotice({ kind: 'info', message: `修订 ${result.revision} 已原子发布，派生状态全量重算完成` });
    },

    toggleBan: (slot) => {
      const s = get();
      const bannedSlots = s.bannedSlots.includes(slot)
        ? s.bannedSlots.filter((x) => x !== slot)
        : [...s.bannedSlots, slot];
      // 封禁属于角色状态变化：同时作用于草稿与活动负载（活动负载派生状态随之重算）
      const activeDerived = derive(s.activeLoadout, bannedSlots);
      set({
        bannedSlots,
        activeDerived,
        ...refreshPreview(s.draftLoadout, bannedSlots, s.alive),
      });
    },

    kill: () => {
      const s = get();
      set({ alive: false, ...refreshPreview(s.draftLoadout, s.bannedSlots, false) });
      pushNotice({ kind: 'reject', message: '角色已进入死亡状态：换装发布与槽位编辑全部锁定' });
    },

    revive: () => {
      const s = get();
      set({ alive: true, ...refreshPreview(s.draftLoadout, s.bannedSlots, true) });
      pushNotice({ kind: 'info', message: '角色已复活，构筑编辑解锁' });
    },

    setAttackInput: (patch) => {
      set((s) => ({ attackInput: { ...s.attackInput, ...patch } }));
    },

    executeAttack: () => {
      const s = get();
      const result = runCombat(
        {
          baseStats: s.baseStats,
          derived: s.activeDerived,
          revision: s.revision,
          skills: s.catalog.skills,
        },
        DUMMY,
        s.attackInput,
      );
      set((st) => ({ combatResults: { ...st.combatResults, [s.revision]: result } }));
    },

    dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  };
});
