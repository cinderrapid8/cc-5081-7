import { useStore } from '../state/store';

export function CharacterPanel() {
  const { alive, kill, revive, bannedSlots, catalog } = useStore();
  return (
    <div className="panel">
      <h2>角色状态</h2>
      <div className="row">
        <span className={alive ? 'badge ok' : 'badge dead'}>{alive ? '存活' : '死亡（换装锁定）'}</span>
        {alive ? (
          <button className="danger" onClick={kill}>模拟角色死亡</button>
        ) : (
          <button className="primary" onClick={revive}>复活角色</button>
        )}
      </div>
      <h3>临时封禁槽位</h3>
      {bannedSlots.length === 0 ? (
        <p className="muted">无封禁。可在构筑面板对任意槽位执行封禁/解封。</p>
      ) : (
        <div className="row">
          {bannedSlots.map((s) => (
            <span key={s} className="badge warning">
              {catalog.slots.find((d) => d.id === s)?.name ?? s}（物品原位保留但完全失效）
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
