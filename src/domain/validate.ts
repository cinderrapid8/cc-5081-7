import type {
  Catalog,
  Diagnostic,
  EffectRule,
  EffectSource,
  ItemDef,
  Loadout,
  SlotId,
  ValidationContext,
} from './types';

export interface AssignedEntry {
  slot: SlotId;
  uid: string;
  itemId: string;
  item: ItemDef;
  suppressed: boolean;
}

/** 展开负载为条目列表；封禁槽位中的条目标记为 suppressed（惰性，仍参与结构性约束） */
export function assignedEntries(
  inventory: Map<string, ItemDef | 'unknown-item'>,
  loadout: Loadout,
  bannedSlots: SlotId[],
): AssignedEntry[] {
  const banned = new Set(bannedSlots);
  const entries: AssignedEntry[] = [];
  for (const [slot, uid] of Object.entries(loadout)) {
    if (!uid) continue;
    const resolved = inventory.get(uid);
    if (!resolved || resolved === 'unknown-item') continue;
    entries.push({ slot, uid, itemId: resolved.id, item: resolved, suppressed: banned.has(slot) });
  }
  return entries;
}

function collectRuleSkillRefs(catalog: Catalog): {
  skillId: string;
  source: EffectSource;
  ruleId: string;
}[] {
  const refs: { skillId: string; source: EffectSource; ruleId: string }[] = [];
  const scan = (rules: EffectRule[], source: EffectSource) => {
    for (const rule of rules) {
      for (const skillId of rule.skills ?? []) {
        refs.push({ skillId, source, ruleId: rule.id });
      }
    }
  };
  for (const item of Object.values(catalog.items)) {
    scan(item.effects, { kind: 'item', uid: '*', itemId: item.id });
  }
  for (const set of Object.values(catalog.sets)) {
    for (const tier of set.tiers) {
      scan(tier.effects, { kind: 'set', setId: set.id, threshold: tier.threshold });
    }
  }
  return refs;
}

/** 发布前静态校验：任何 error 都会阻断发布；warning 不阻断但必须能在界面解释 */
export function validate(ctx: ValidationContext): Diagnostic[] {
  const { catalog, loadout, bannedSlots, alive } = ctx;
  const diagnostics: Diagnostic[] = [];

  const inventoryByUid = new Map<string, ItemDef | 'unknown-item'>();
  for (const inst of ctx.inventory) {
    const def = catalog.items[inst.itemId];
    inventoryByUid.set(inst.uid, def ? def : 'unknown-item');
  }

  const slotDefs = new Set(catalog.slots.map((s) => s.id));
  const seenUid = new Map<string, SlotId>();
  const tagOwners = new Map<string, { uid: string; itemId: string; slot: SlotId }[]>();

  for (const [slot, uid] of Object.entries(loadout)) {
    if (!uid) continue;

    if (!slotDefs.has(slot)) {
      diagnostics.push({
        code: 'unknown-slot',
        level: 'error',
        message: `负载引用了不存在的槽位「${slot}」`,
        related: { slot, uid },
      });
      continue;
    }

    const resolved = inventoryByUid.get(uid);
    if (!resolved) {
      diagnostics.push({
        code: 'unknown-instance',
        level: 'error',
        message: `物品实例 ${uid} 不在背包中，无法装备`,
        related: { slot, uid },
      });
      continue;
    }
    if (resolved === 'unknown-item') {
      const itemId = ctx.inventory.find((i) => i.uid === uid)!.itemId;
      diagnostics.push({
        code: 'unknown-item',
        level: 'error',
        message: `实例 ${uid} 指向的物品定义 ${itemId} 在目录中缺失`,
        related: { slot, uid, itemId },
      });
      continue;
    }

    // 同一物品实例被多个槽位重复引用
    const firstSlot = seenUid.get(uid);
    if (firstSlot) {
      diagnostics.push({
        code: 'duplicate-instance',
        level: 'error',
        message: `物品实例 ${uid}（${resolved.name}）同时被槽位「${firstSlot}」与「${slot}」引用，同一实例不能重复装备`,
        related: { slot, uid, itemId: resolved.id },
      });
    } else {
      seenUid.set(uid, slot);
    }

    // 槽位兼容性
    if (!resolved.slots.includes(slot)) {
      diagnostics.push({
        code: 'slot-incompatible',
        level: 'error',
        message: `物品「${resolved.name}」与槽位「${slot}」不兼容（允许：${resolved.slots.join('、')}）`,
        related: { slot, uid, itemId: resolved.id },
      });
    }

    // 互斥标签（封禁槽位中的物品依然占据标签，保证解封后状态可解释）
    for (const tag of resolved.tags) {
      const owners = tagOwners.get(tag) ?? [];
      owners.push({ uid, itemId: resolved.id, slot });
      tagOwners.set(tag, owners);
    }
  }

  for (const [tag, owners] of tagOwners) {
    if (owners.length > 1) {
      for (const owner of owners) {
        diagnostics.push({
          code: 'mutex-tag',
          level: 'error',
          message: `互斥标签「${tag}」冲突：${owners
            .map((o) => `${o.itemId}@${o.slot}`)
            .join(' 与 ')} 不能同时装备`,
          related: { tag, uid: owner.uid, itemId: owner.itemId, slot: owner.slot },
        });
      }
    }
  }

  const entries = assignedEntries(inventoryByUid, loadout, bannedSlots);

  // 套装互斥组：同一组内两套各自达到最低档位即冲突
  const activeEntries = entries.filter((e) => !e.suppressed);
  const pieceCounts = new Map<string, number>();
  for (const e of activeEntries) {
    if (!e.item.setId) continue;
    pieceCounts.set(e.item.setId, (pieceCounts.get(e.item.setId) ?? 0) + 1);
  }
  const groupSets = new Map<string, { setId: string; pieces: number; minThreshold: number }[]>();
  for (const [setId, pieces] of pieceCounts) {
    const set = catalog.sets[setId];
    if (!set || !set.mutexGroup) continue;
    const minThreshold = Math.min(...set.tiers.map((t) => t.threshold));
    if (pieces < minThreshold) continue;
    const list = groupSets.get(set.mutexGroup) ?? [];
    list.push({ setId, pieces, minThreshold });
    groupSets.set(set.mutexGroup, list);
  }
  for (const [group, members] of groupSets) {
    if (members.length > 1) {
      for (const m of members) {
        diagnostics.push({
          code: 'mutex-set',
          level: 'error',
          message: `互斥套装组「${group}」冲突：${members
            .map((x) => `${catalog.sets[x.setId].name}(${x.pieces}件)`)
            .join(' 与 ')} 不能同时激活`,
          related: { setId: m.setId },
        });
      }
    }
  }

  // 失效技能引用定位（只针对当前负载中实际会参与求值的规则；物品/套装不在装则不报错）
  const equippedItemIds = new Set(entries.map((e) => e.itemId));
  const activeSetIds = new Set(
    [...pieceCounts]
      .filter(([setId, n]) => {
        const set = catalog.sets[setId];
        return set && n >= Math.min(...set.tiers.map((t) => t.threshold));
      })
      .map(([setId]) => setId),
  );
  for (const ref of collectRuleSkillRefs(catalog)) {
    if (catalog.skills[ref.skillId]) continue;
    let relevant = false;
    if (ref.source.kind === 'item' && equippedItemIds.has(ref.source.itemId)) relevant = true;
    if (ref.source.kind === 'set' && activeSetIds.has(ref.source.setId)) relevant = true;
    if (!relevant) continue;
    const where =
      ref.source.kind === 'item'
        ? `物品 ${ref.source.itemId} 的效果规则 ${ref.ruleId}`
        : `套装 ${ref.source.setId} 第 ${ref.source.threshold} 档规则 ${ref.ruleId}`;
    diagnostics.push({
      code: 'broken-skill-ref',
      level: 'error',
      message: `失效引用：${where} 引用了不存在的技能「${ref.skillId}」，发布前必须修复`,
      related: {
        skillId: ref.skillId,
        effectId: ref.ruleId,
        itemId: ref.source.kind === 'item' ? ref.source.itemId : undefined,
        setId: ref.source.kind === 'set' ? ref.source.setId : undefined,
      },
    });
  }

  // 封禁槽位的一致解释：warning，不阻断，但界面必须展示为惰性
  for (const slot of bannedSlots) {
    const uid = loadout[slot];
    if (uid) {
      const def = inventoryByUid.get(uid);
      diagnostics.push({
        code: 'slot-banned',
        level: 'warning',
        message: `槽位「${slot}」已被临时封禁，其中物品${
          def && def !== 'unknown-item' ? `「${def.name}」` : ''
        }保持原位但完全失效：不计属性、不计套装部件、不提供技能`,
        related: { slot, uid },
      });
    }
  }

  // 角色死亡：禁止任何换装发布
  if (!alive) {
    diagnostics.push({
      code: 'character-dead',
      level: 'error',
      message: '角色已死亡，无法发布换装修订；请先复活再调整负载',
    });
  }

  return diagnostics;
}

export function hasBlockingErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.level === 'error');
}
