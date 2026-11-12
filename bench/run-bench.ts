import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCALES, SCOPES, runTiming, type ChangeScope } from './bench';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

interface AllocRow {
  scale: string;
  scope: ChangeScope;
  steps: number;
  indexBuildBytes: number;
  fullBytes: number;
  incBytes: number;
  perStepFull: number;
  perStepInc: number;
}

interface ProbeOutput {
  meta: { scale: string; scope: ChangeScope; steps: number } | null;
  phases: { name: string; bytes: number }[];
  ok: boolean;
  error?: string;
}

const QUICK = process.argv.includes('--quick');
// 单次修改在毫秒级，样本太少会被调度噪声主导；默认采样足够多步再取平均
const STEPS = QUICK ? 16 : 64;
/** 变更序列重复轮数：每轮重新建增量求值器，避免跨轮缓存累积 */
const ROUNDS = QUICK ? 2 : 4;

function parseProbe(stdout: string): ProbeOutput {
  // --trace-gc-nvp 的 GC 记录与阶段标记都走 stdout，同流保证边界顺序
  const lines = stdout.split('\n');
  const phases: { name: string; bytes: number }[] = [];
  let meta: ProbeOutput['meta'] = null;
  let current: string | null = null;
  let accrued = 0;
  for (const line of lines) {
    const metaMatch = line.match(/^@@META (.*)$/);
    if (metaMatch) {
      meta = JSON.parse(metaMatch[1]);
      continue;
    }
    const startMatch = line.match(/^@@PHASE-START (\S+)/);
    if (startMatch) {
      current = startMatch[1];
      accrued = 0;
      continue;
    }
    const allocMatch = line.match(/\ballocated=(\d+)/);
    if (allocMatch && current) {
      const n = Number(allocMatch[1]);
      // 无符号回绕表示该次 GC 无可分配记录，忽略异常值
      if (Number.isFinite(n) && n >= 0 && n < 2 ** 52) accrued += n;
      continue;
    }
    const endMatch = line.match(/^@@PHASE-END (\S+)/);
    if (endMatch) {
      phases.push({ name: endMatch[1], bytes: accrued });
      current = null;
      accrued = 0;
    }
  }
  const ok = phases.length > 0 && Boolean(meta);
  return { meta, phases, ok, error: ok ? undefined : stdout.split('\n').slice(-12).join('\n') };
}

function runProbeSpawn(scaleLabel: string, scope: ChangeScope): ProbeOutput {
  const proc = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      '--trace-gc-nvp',
      join(root, 'node_modules/vite-node/vite-node.mjs'),
      '--root',
      root,
      join(here, 'alloc-probe.ts'),
      scaleLabel,
      scope,
      String(STEPS),
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (proc.status !== 0) {
    return { meta: null, phases: [], ok: false, error: (proc.stderr ?? '').split('\n').slice(-10).join('\n') };
  }
  return parseProbe(proc.stdout ?? '');
}

interface IndexProbe {
  scale: string;
  median: number;
  min: number;
  max: number;
}

/** 索引建立成本：独立子进程内预热后取 15 次构造的中位数 */
function runIndexProbe(scaleLabel: string): IndexProbe | null {
  const proc = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      '--experimental-strip-types',
      join(root, 'node_modules/vite-node/vite-node.mjs'),
      '--root',
      root,
      join(here, 'index-probe.ts'),
      scaleLabel,
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (proc.status !== 0) {
    process.stderr.write(`[index] ${scaleLabel} FAILED: ${(proc.stderr ?? '').split('\n').slice(-6).join('\n')}\n`);
    return null;
  }
  const match = (proc.stdout ?? '').match(/^@@INDEX (.*)$/m);
  return match ? (JSON.parse(match[1]) as IndexProbe) : null;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

function fmtMs(n: number): string {
  return `${n.toFixed(3)} ms`;
}

function main(): void {
  const indexRows: IndexProbe[] = [];
  for (const scale of SCALES) {
    const probe = runIndexProbe(scale.label);
    if (probe) {
      indexRows.push(probe);
      process.stdout.write(
        `[index]  ${scale.label.padEnd(6)} build median=${fmtMs(probe.median).padStart(10)} (${fmtMs(probe.min)}–${fmtMs(probe.max)})\n`,
      );
    }
  }

  const timingRows = [];
  for (const scale of SCALES) {
    for (const scope of SCOPES) {
      const row = runTiming(scale, scope, STEPS, ROUNDS);
      timingRows.push(row);
      process.stdout.write(
        `[timing] ${scale.label.padEnd(6)} ${scope.padEnd(11)} full=${fmtMs(row.avgFullMs).padStart(10)} inc=${fmtMs(
          row.avgIncMs,
        ).padStart(10)} ratio=${row.ratio.toFixed(2)}x eq=${row.equivalent} deact=${row.deactivationMatch} report=${row.changeReportMatch}\n`,
      );
    }
  }

  const allocRows: AllocRow[] = [];
  for (const scale of SCALES) {
    for (const scope of SCOPES) {
      const probe = runProbeSpawn(scale.label, scope);
      if (!probe.ok || !probe.meta) {
        process.stderr.write(`[alloc] ${scale.label}/${scope} FAILED: ${probe.error}\n`);
        continue;
      }
      const get = (name: string) => probe.phases.find((p) => p.name === name)?.bytes ?? 0;
      const row: AllocRow = {
        scale: scale.label,
        scope,
        steps: probe.meta.steps,
        indexBuildBytes: get('index-build'),
        fullBytes: get('full'),
        incBytes: get('incremental'),
        perStepFull: get('full') / probe.meta.steps,
        perStepInc: get('incremental') / probe.meta.steps,
      };
      allocRows.push(row);
      process.stdout.write(
        `[alloc]  ${scale.label.padEnd(6)} ${scope.padEnd(11)} index=${fmtBytes(row.indexBuildBytes).padStart(10)} full/step=${fmtBytes(
          row.perStepFull,
        ).padStart(10)} inc/step=${fmtBytes(row.perStepInc).padStart(10)}\n`,
      );
    }
  }

  const report = renderReport(timingRows, allocRows, indexRows);
  const outDir = join(root, 'bench', 'results');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'latest.md'), report, 'utf8');
  writeFileSync(
    join(outDir, 'latest.json'),
    JSON.stringify({ timing: timingRows, allocation: allocRows, index: indexRows }, null, 2),
    'utf8',
  );
  process.stdout.write(`\n${report}\n`);
}

function renderReport(
  timing: ReturnType<typeof runTiming>[],
  alloc: AllocRow[],
  index: IndexProbe[],
): string {
  const lines: string[] = [];
  lines.push('# 增量求值 vs 全量参照：实测汇总');
  lines.push('');
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(`- 每格 ${STEPS} 步 × ${ROUNDS} 轮 = ${STEPS * ROUNDS} 次求值取平均；耗时取 process.hrtime，分配量由独立子进程 + 强制 GC 分段统计`);
  lines.push('- 等价列逐规则比较来源身份 / 激活状态 / 未激活原因 / 技能 / 档位 / 部件数 / 失效引用；deact 与 report 列分别对比来源撤销事件与发布变化报告');
  lines.push('');
  lines.push('## 索引建立成本（独立子进程，预热后 15 次构造）');
  lines.push('');
  lines.push('| 规模 | 中位数 | 最小 | 最大 |');
  lines.push('|---|---|---|---|');
  for (const r of index) {
    lines.push(`| ${r.scale} | ${fmtMs(r.median)} | ${fmtMs(r.min)} | ${fmtMs(r.max)} |`);
  }
  lines.push('');
  lines.push('## 耗时（每步平均）');
  lines.push('');
  lines.push('| 规模 | 修改范围 | 物品 | 规则 | 套档 | 全量 ms | 增量 ms | 加速比 | 依赖查找 ms | 阈值更新 ms | 效果发布 ms | 重算规则 | 复用规则 | 等价 | deact | report |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of timing) {
    lines.push(
      `| ${r.scale} | ${r.scope} | ${r.items} | ${r.rules} | ${r.setTiers} | ${r.avgFullMs.toFixed(3)} | ${r.avgIncMs.toFixed(3)} | ${r.ratio.toFixed(2)}x | ${r.avgIncDepMs.toFixed(3)} | ${r.avgIncThresholdMs.toFixed(3)} | ${r.avgIncPublishMs.toFixed(3)} | ${r.avgRulesEvaluated.toFixed(1)} | ${r.avgRulesReused.toFixed(1)} | ${r.equivalent ? '✓' : '✗'}(${r.differenceCount}) | ${r.deactivationMatch ? '✓' : '✗'} | ${r.changeReportMatch ? '✓' : '✗'} |`,
    );
  }
  lines.push('');
  lines.push('## 分配量（每步平均，独立子进程）');
  lines.push('');
  lines.push('| 规模 | 修改范围 | 索引建立 | 全量/步 | 增量/步 | 分配比 |');
  lines.push('|---|---|---|---|---|---|');
  for (const a of alloc) {
    lines.push(
      `| ${a.scale} | ${a.scope} | ${fmtBytes(a.indexBuildBytes)} | ${fmtBytes(a.perStepFull)} | ${fmtBytes(a.perStepInc)} | ${a.perStepInc === 0 ? '—' : (a.perStepFull / a.perStepInc).toFixed(2)}x |`,
    );
  }
  lines.push('');
  lines.push('> 说明：小规模（small）的索引建立成本按一次性开销列出，增量路径的每步耗时包含依赖查找与效果发布，不包含索引建立；');
  lines.push('> 若 small 行加速比 < 1，表示小输入下增量调度开销没有摊薄，报告如实保留，不做删除。');
  return lines.join('\n');
}

main();
