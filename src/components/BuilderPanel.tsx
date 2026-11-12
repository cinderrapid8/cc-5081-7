import { useStore } from '../state/store';
import type { ItemInstance } from '../domain/types';

export function BuilderPanel() {
  const { catalog, inventory, draftLoadout, bannedSlots, alive, draftDerived, draftDiagnostics, assign, reassignMove, clearSlot, toggleBan } =
    useStore();

  const optionsFor = (slot: string): ItemInstance[] =>
    inventory.filter((inst) => catalog.items[inst.itemId]?.slots.includes(slot));

  const usedUids = new Set(Object.values(draftLoadout).filter(Boolean) as string[]);
  const errorCount = draftDiagnostics.filter((d) => d.level === 'error').length;

  return (
    <div className="panel">
      <h2>构筑编辑（草稿，与角色实际采用方案分离）</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="muted">草稿预览：</span>
        {Object.keys(catalog.sets).map((setId) => {
          const count = draftDerived.setPieceCounts[setId] ?? 0;
          const tier = draftDerived.setTiers[setId] ?? 0;
          return (
            <span key={setId} className={tier ? 'badge ok' : 'badge'}>
              {catalog.sets[setId].name} {count}件{tier ? ` / 第${tier}档` : ' / 未激活'}
            </span>
          );
        })}
        <span className={errorCount ? 'badge error' : 'badge ok'}>
          {errorCount ? `${errorCount} 个阻断错误` : '可发布'}
        </span>
      </div>
      {!alive && <p><span className="badge dead">角色死亡</span> 槽位编辑与发布已锁定，复活后才能调整</p>}
      {catalog.slots.map((slotDef) => {
        const uid = draftLoadout[slotDef.id];
        const banned = bannedSlots.includes(slotDef.id);
        const item = uid ? catalog.items[inventory.find((i) => i.uid === uid)?.itemId ?? ''] : null;
        const duplicated =
          uid && Object.entries(draftLoadout).filter(([, u]) => u === uid).length > 1;
        return (
          <div key={slotDef.id} className={`slot-row ${banned ? 'banned' : ''}`}>
            <div>
              <strong>{slotDef.name}</strong>
              <div className="muted mono" style={{ fontSize: 11 }}>{slotDef.id}</div>
              {banned && <span className="badge warning">临时封禁</span>}
            </div>
            <div>
              <select
                value={uid ?? ''}
                disabled={!alive || banned}
                onChange={(e) => assign(slotDef.id, e.target.value || null)}
              >
                <option value="">（空槽位）</option>
                {optionsFor(slotDef.id).map((inst) => {
                  const def = catalog.items[inst.itemId];
                  const usedElsewhere = usedUids.has(inst.uid) && draftLoadout[slotDef.id] !== inst.uid;
                  return (
                    <option key={inst.uid} value={inst.uid}>
                      {def.name} [{inst.uid}]{usedElsewhere ? '（已在其他槽位）' : ''}
                    </option>
                  );
                })}
              </select>
              {item && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  标签：{item.tags.length ? item.tags.join('、') : '无'}
                  {item.setId && ` ｜ 套装：${catalog.sets[item.setId].name}`}
                  {duplicated && <span className="badge error" style={{ marginLeft: 8 }}>重复实例引用</span>}
                  {banned && <span className="badge warning" style={{ marginLeft: 8 }}>效果完全失效</span>}
                </div>
              )}
            </div>
            <div className="row">
              <button
                disabled={!alive || banned || !uid}
                title="把该实例从原槽位移入此槽位（原槽位自动清空）"
                onClick={() => uid && reassignMove(slotDef.id, uid)}
              >
                移动
              </button>
              <button disabled={!alive || banned || !uid} onClick={() => clearSlot(slotDef.id)}>
                卸下
              </button>
              <button
                className={banned ? '' : 'danger'}
                title="封禁/解封是角色状态变化，同时作用于草稿与活动方案"
                onClick={() => toggleBan(slotDef.id)}
              >
                {banned ? '解封' : '封禁'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
