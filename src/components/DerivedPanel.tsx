import { useStore } from '../state/store';
import type { StatKey, StatMap } from '../domain/types';

const STAT_LABELS: Record<StatKey, string> = {
  hp: '生命', mp: '法力', atk: '攻击', def: '防御', str: '力量', dex: '敏捷',
  int: '智力', critChance: '暴击率', critDamage: '暴击伤害', physicalMitigation: '物理减伤',
  fireDamage: '火焰加伤', iceDamage: '冰霜加伤', lifesteal: '吸血%', shield: '护盾', haste: '急速',
};

function StatGrid({ base, bonus }: { base: StatMap; bonus: StatMap }) {
  const keys = [...new Set([...Object.keys(base), ...Object.keys(bonus)])] as StatKey[];
  return (
    <div className="stat-grid">
      {keys.map((k) => {
        const b = base[k] ?? 0;
        const x = bonus[k] ?? 0;
        return (
          <div key={k} className="stat-cell">
            <div className="k">{STAT_LABELS[k]}</div>
            <div className="v">
              {b + x}
              {x !== 0 && (
                <span className={x > 0 ? 'delta-pos' : 'delta-neg'} style={{ marginLeft: 6, fontSize: 11 }}>
                  {x > 0 ? `+${x}` : x}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DerivedPanel() {
  const { catalog, baseStats, draftDerived, activeDerived, revision, activeLoadout } = useStore();

  return (
    <div className="panel">
      <h2>派生状态与来源审计</h2>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="badge info">活动方案 修订 #{revision}</span>
        <span className="muted">战斗只读取活动方案的派生状态</span>
      </div>

      <h3>活动方案最终属性</h3>
      <StatGrid base={baseStats} bonus={activeDerived.stats} />

      <h3>激活技能（含来源校验）</h3>
      {activeDerived.skills.length === 0 && <p className="muted">无技能</p>}
      <div className="row">
        {activeDerived.skills.map((id) => {
          const skill = catalog.skills[id];
          return (
            <span key={id} className={`badge ${skill ? 'ok' : 'error'}`} title={skill?.description ?? '失效引用'}>
              {skill ? skill.name : `失效引用: ${id}`}
            </span>
          );
        })}
      </div>

      <h3>套装分档（有效部件数）</h3>
      {Object.keys(catalog.sets).map((setId) => {
        const count = activeDerived.setPieceCounts[setId] ?? 0;
        const tier = activeDerived.setTiers[setId] ?? 0;
        return (
          <div key={setId} className="row" style={{ marginBottom: 4 }}>
            <strong>{catalog.sets[setId].name}</strong>
            <span className="badge info">{count} 件</span>
            <span className={tier ? 'badge ok' : 'badge'}>
              {tier ? `激活至第 ${tier} 档` : '未激活'}
            </span>
          </div>
        );
      })}

      {activeDerived.suppressed.length > 0 && (
        <>
          <h3>封禁槽位中的惰性物品</h3>
          {activeDerived.suppressed.map((s) => (
            <div key={s.uid} className="trace">
              {catalog.items[s.itemId]?.name} <span className="muted">({s.uid} @ {s.slot})</span>
              <span className="badge warning" style={{ marginLeft: 8 }}>不计属性 / 不计套装 / 不给技能</span>
            </div>
          ))}
        </>
      )}

      <h3>草稿效果规则追踪（激活与未激活原因）</h3>
      {draftDerived.traces.map((t, i) => {
        const src =
          t.source.kind === 'item'
            ? `物品 ${catalog.items[t.source.itemId]?.name ?? t.source.itemId} (${t.source.uid})`
            : `套装 ${catalog.sets[t.source.setId]?.name} 第${t.source.threshold}档`;
        return (
          <div key={i} className={`trace ${t.active ? '' : 'inactive'}`}>
            <span className={`badge ${t.active ? 'ok' : 'warning'}`}>{t.active ? '激活' : '未激活'}</span>{' '}
            <strong>{t.ruleId}</strong> <span className="muted">← {src}</span>
            {!t.active && <div className="reason">原因：{t.inactiveReason}</div>}
          </div>
        );
      })}

      <h3>当前活动负载</h3>
      <div className="mono muted" style={{ fontSize: 12 }}>
        {Object.entries(activeLoadout)
          .map(([slot, uid]) => `${slot}=${uid ?? '∅'}`)
          .join(' ｜ ')}
      </div>
    </div>
  );
}
