import { IncrementalEvaluator } from '../src/domain/incremental';
import { buildScenario, SCALES, SCOPES } from './bench';

declare const gc: undefined | (() => void);

const scaleLabel = process.argv[2] ?? 'n64';
const scale = SCALES.find((s) => s.label === scaleLabel)!;
const { catalog, inventory } = buildScenario(scale, SCOPES[0], 1);

// 预热：让 JIT 编译构造器路径
new IncrementalEvaluator(catalog, inventory);

const samples: number[] = [];
for (let i = 0; i < 15; i++) {
  if (typeof gc === 'function') gc();
  const start = process.hrtime.bigint();
  new IncrementalEvaluator(catalog, inventory);
  samples.push(Number(process.hrtime.bigint() - start) / 1e6);
}
samples.sort((a, b) => a - b);
process.stdout.write(
  `@@INDEX ${JSON.stringify({ scale: scaleLabel, median: samples[7], min: samples[0], max: samples[14] })}\n`,
);
