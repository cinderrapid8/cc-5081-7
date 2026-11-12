import { useStore } from '../state/store';

export function DiagnosticsPanel() {
  const { draftDiagnostics, lastPublishErrors } = useStore();
  const errors = draftDiagnostics.filter((d) => d.level === 'error');
  const warnings = draftDiagnostics.filter((d) => d.level === 'warning');

  return (
    <div className="panel">
      <h2>约束检查（发布门禁）</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className={`badge ${errors.length ? 'error' : 'ok'}`}>
          {errors.length ? `${errors.length} 个阻断错误` : '无阻断错误'}
        </span>
        <span className={`badge ${warnings.length ? 'warning' : 'ok'}`}>
          {warnings.length ? `${warnings.length} 个警告` : '无警告'}
        </span>
      </div>
      {draftDiagnostics.length === 0 && <p className="muted">草稿满足全部结构性与引用约束。</p>}
      {draftDiagnostics.map((d, i) => (
        <div key={i} className={`diag ${d.level}`}>
          <span className={`badge ${d.level}`}>{d.code}</span> {d.message}
          {d.related && (
            <div className="muted mono" style={{ fontSize: 11, marginTop: 3 }}>
              定位：{JSON.stringify(d.related)}
            </div>
          )}
        </div>
      ))}
      {lastPublishErrors && (
        <p className="badge error" style={{ marginTop: 10 }}>
          上一次发布被拒绝，活动负载与战斗结果保持不变（无半套中间状态）
        </p>
      )}
    </div>
  );
}
