import { useStore } from '../state/store';

function ms(n: number | undefined): string {
  return n === undefined ? '—' : `${n.toFixed(3)} ms`;
}

export function AuditPanel() {
  const { lastVerdict, lastChanges, revision } = useStore();
  const metrics = lastVerdict?.metrics ?? null;

  return (
    <div className="panel">
      <h2>增量求值审计（与全量参照逐规则对照）</h2>
      <p className="muted" style={{ fontSize: 12 }}>
        发布按钮走真实增量求值；发布后立刻用全量参照重算同一负载，逐条对比来源身份、激活状态、
        未激活原因、技能与套装档位，并对比来源级撤销事件。面板不是固定数据，全部来自本次发布。
      </p>

      {!lastVerdict && <p className="muted">尚无发布记录：完成一次发布后显示本次实测数据。</p>}

      {lastVerdict && metrics && (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="badge info">修订 #{revision}</span>
            <span className={`badge ${lastVerdict.equivalence?.equivalent ? 'ok' : 'error'}`}>
              {lastVerdict.equivalence?.equivalent ? '增量与全量等价' : '检测到差异'}
            </span>
            <span className="badge info">变更槽位 {metrics.changedSlots}</span>
            <span className="badge info">标签翻转 {metrics.changedTags}</span>
            <span className="badge info">跨档位 {metrics.changedSetTiers}</span>
          </div>

          <table>
            <thead>
              <tr>
                <th>阶段</th>
                <th>耗时</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>索引建立</td>
                <td>{ms(lastVerdict.metrics?.indexBuildMs)}</td>
                <td>一次性构建（本会话第 {lastVerdict.metrics?.indexBuilds} 次）</td>
              </tr>
              <tr>
                <td>依赖查找</td>
                <td>{ms(metrics.dependencyLookupMs)}</td>
                <td>槽位 diff + 标签/属性反向索引失效标记</td>
              </tr>
              <tr>
                <td>阈值更新</td>
                <td>{ms(metrics.thresholdUpdateMs)}</td>
                <td>只重算部件数变化的套装档位</td>
              </tr>
              <tr>
                <td>效果发布</td>
                <td>{ms(metrics.effectPublishMs)}</td>
                <td>重建脏槽位/脏套装块并拼接干净块</td>
              </tr>
              <tr>
                <td>重算 / 复用规则</td>
                <td>{metrics.rulesEvaluated} / {metrics.rulesReused}</td>
                <td>发布共输出 {metrics.rulesEmitted} 条 trace</td>
              </tr>
            </tbody>
          </table>

          {lastVerdict.equivalence && (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="badge info">增量撤销来源 {lastVerdict.equivalence.incrementalDeactivated.length}</span>
              <span className="badge info">参照撤销来源 {lastVerdict.equivalence.referenceDeactivated.length}</span>
              {lastVerdict.equivalence.differences.map((d) => (
                <span key={d} className="badge error">{d}</span>
              ))}
            </div>
          )}
        </>
      )}

      {lastChanges && (
        <p className="muted mono" style={{ fontSize: 11 }}>
          最近一次变化报告：+{lastChanges.sourcesActivated.length} 来源 / -{lastChanges.sourcesDeactivated.length} 来源，
          技能 +{lastChanges.skillsGained.length} / -{lastChanges.skillsLost.length}
        </p>
      )}
    </div>
  );
}
