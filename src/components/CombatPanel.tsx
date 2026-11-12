import { useState } from 'react';
import { useStore } from '../state/store';
import type { DamageElement } from '../domain/types';

export function CombatPanel() {
  const { attackInput, setAttackInput, executeAttack, combatResults, revision, alive } = useStore();
  const [compareWith, setCompareWith] = useState<number | ''>('');

  const current = combatResults[revision];
  const other = compareWith === '' ? undefined : combatResults[compareWith];
  const revisions = Object.keys(combatResults).map(Number).sort((a, b) => a - b);

  return (
    <div className="panel">
      <h2>战斗假人（相同攻击输入，比较不同负载的真实效果）</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        <label>
          随机种子 <input
            type="number"
            value={attackInput.seed}
            onChange={(e) => setAttackInput({ seed: Number(e.target.value) })}
            style={{ minWidth: 110 }}
          />
        </label>
        <label>
          回合数 <input
            type="number"
            min={1}
            max={20}
            value={attackInput.turns}
            onChange={(e) => setAttackInput({ turns: Number(e.target.value) })}
            style={{ minWidth: 70 }}
          />
        </label>
        <label>
          攻击属性{' '}
          <select
            value={attackInput.element}
            onChange={(e) => setAttackInput({ element: e.target.value as DamageElement })}
          >
            <option value="physical">物理</option>
            <option value="fire">火焰</option>
            <option value="ice">冰霜</option>
          </select>
        </label>
        <button className="primary" disabled={!alive} onClick={executeAttack}>
          对活动方案（修订 #{revision}）执行攻击
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        种子、回合数、攻击属性完全一致时，不同负载面对的是同一串随机数与同一只假人，差异只来自装备。
        草稿未发布不会产生任何战斗结果。
      </p>

      {current && (
        <>
          <h3>修订 #{revision} 战斗结果</h3>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="badge info">总伤害 {current.totalDamage}</span>
            <span className="badge info">剩余生命 {current.finalHp}</span>
            <span className="badge info">剩余护盾 {current.finalShield}</span>
            <span className={current.dead ? 'badge dead' : 'badge ok'}>
              {current.dead ? '角色死亡' : '角色存活'}
            </span>
            <span className={current.dummyDead ? 'badge ok' : 'badge'}>
              {current.dummyDead ? '假人被击破' : '假人存活'}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>回合</th><th>造成</th><th>承受</th><th>暴击</th><th>急速</th>
                <th>护盾吸收</th><th>吸血回复</th><th>生命</th><th>假人血量</th><th>生效技能</th>
              </tr>
            </thead>
            <tbody>
              {current.logs.map((l) => (
                <tr key={l.turn}>
                  <td>{l.turn}</td>
                  <td>{l.dealt}</td>
                  <td>{l.taken}</td>
                  <td>{l.crit ? '✓' : ''}</td>
                  <td>{l.hasteProc ? '✓' : ''}</td>
                  <td>{l.shieldAbsorb}</td>
                  <td>{l.healed}</td>
                  <td>{l.hpAfter}</td>
                  <td>{l.dummyHpAfter}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{l.appliedSkills.join(',') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {current.logs.some((l) => l.note) && (
            <p className="muted" style={{ fontSize: 12 }}>
              {current.logs.find((l) => l.note)?.note}
            </p>
          )}
        </>
      )}

      <h3>修订间对比</h3>
      <div className="row">
        <select value={compareWith} onChange={(e) => setCompareWith(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">选择历史修订…</option>
          {revisions.filter((r) => r !== revision).map((r) => (
            <option key={r} value={r}>修订 #{r}</option>
          ))}
        </select>
        {other && current && (
          <div className="row">
            <span className={current.totalDamage >= other.totalDamage ? 'compare-win badge ok' : 'compare-lose badge error'}>
              总伤害：#{revision} {current.totalDamage} vs #{compareWith} {other.totalDamage}
              （差 {current.totalDamage - other.totalDamage}）
            </span>
            <span className="badge info">剩余生命差：{current.finalHp - other.finalHp}</span>
          </div>
        )}
      </div>
    </div>
  );
}
