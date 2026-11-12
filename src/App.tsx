import { BuilderPanel } from './components/BuilderPanel';
import { CharacterPanel } from './components/CharacterPanel';
import { CombatPanel } from './components/CombatPanel';
import { DerivedPanel } from './components/DerivedPanel';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { Notices } from './components/Notices';
import { PublishPanel } from './components/PublishPanel';

export function App() {
  return (
    <div className="app">
      <h1>装备负载执行器</h1>
      <p className="subtitle">
        槽位兼容 · 互斥标签 · 条件效果 · 套装分档 · 失效引用定位 · 原子发布 · 同输入假人对比
      </p>
      <div className="grid">
        <CharacterPanel />
        <DiagnosticsPanel />
        <BuilderPanel />
        <DerivedPanel />
        <PublishPanel />
        <CombatPanel />
      </div>
      <Notices />
    </div>
  );
}
