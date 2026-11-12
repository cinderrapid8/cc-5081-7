import { useStore } from '../state/store';

export function PublishPanel() {
  const { draftDiagnostics, publish, resetDraft, lastChanges, history, revision, alive } = useStore();
  const blocked = draftDiagnostics.some((d) => d.level === 'error') || !alive;

  return (
    <div className="panel">
      <h2>发布链路（原子提交）</h2>
      <div className="row">
        <button className="primary" disabled={blocked} onClick={publish}>
          发布修订（完整通过校验才生效）
        </button>
        <button onClick={resetDraft}>放弃草稿，回到活动方案</button>
        <span className="badge info">当前修订 #{revision}</span>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        发布采用“先全量校验、后单次替换、再全量重算”的管线；任何 error 都会原样拒绝，
        不会出现逐件脱装留下的半套状态。
      </p>

      {lastChanges && (
        <>
          <h3>修订 #{lastChanges.revision} 变化报告（来源级激活/撤销）</h3>
          <div className="row" style={{ marginBottom: 6 }}>
            {Object.entries(lastChanges.statDeltas).map(([k, v]) => (
              <span key={k} className={`badge ${v! > 0 ? 'ok' : 'error'}`}>
                {k} {v! > 0 ? `+${v}` : v}
              </span>
            ))}
          </div>
          {lastChanges.setTierChanges.map((c) => (
            <div key={c.setId} className="trace">
              套装 {c.setId} 档位 {c.from} → {c.to}
            </div>
          ))}
          {lastChanges.skillsGained.map((s) => (
            <div key={`g${s}`} className="trace"><span className="badge ok">获得技能</span> {s}</div>
          ))}
          {lastChanges.skillsLost.map((s) => (
            <div key={`l${s}`} className="trace"><span className="badge error">撤销技能</span> {s}</div>
          ))}
          {lastChanges.sourcesActivated.map((s) => (
            <div key={`a${s}`} className="trace"><span className="badge ok">来源激活</span> {s}</div>
          ))}
          {lastChanges.sourcesDeactivated.map((s) => (
            <div key={`d${s}`} className="trace"><span className="badge error">来源撤销</span> {s}</div>
          ))}
        </>
      )}

      <h3>发布历史</h3>
      {history.length === 0 && <p className="muted">暂无已发布修订</p>}
      {history.map((h) => (
        <div key={h.revision} className="trace mono">
          #{h.revision}：属性变化 {JSON.stringify(h.changes.statDeltas)}
          {h.changes.setTierChanges.length > 0 &&
            ` ｜ 档位 ${h.changes.setTierChanges.map((c) => `${c.setId}:${c.from}→${c.to}`).join(', ')}`}
        </div>
      ))}
    </div>
  );
}
