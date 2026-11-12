import { buildAllocationPhases, SCALES, type ChangeScope } from './bench';

declare const gc: undefined | (() => void);

interface GcMark {
  allocated: number;
}

function totalAllocated(): number {
  // allocated 字节数由父进程从 --trace-gc-nvp 中解析，这里只负责写标记
  return 0;
}

function mark(name: string): void {
  if (typeof gc === 'function') gc();
  // 与 --trace-gc-nvp 的 GC 记录同走 stdout：两路同流才能保持阶段边界顺序
  process.stdout.write(`@@PHASE-START ${name} ${totalAllocated()}\n`);
}

function endMark(name: string, value: number): void {
  if (typeof gc === 'function') gc();
  process.stdout.write(`@@PHASE-END ${name} ${totalAllocated()} ${value}\n`);
}

const [, , scaleLabel, scopeArg, stepsArg] = process.argv;
const scale = SCALES.find((s) => s.label === scaleLabel);
if (!scale) throw new Error(`unknown scale ${scaleLabel}`);
const scope = scopeArg as ChangeScope;
const steps = Number(stepsArg);

const { phases, meta } = buildAllocationPhases(scale, scope, steps);
process.stdout.write(`@@META ${JSON.stringify(meta)}\n`);
for (const phase of phases) {
  mark(phase.name);
  const value = phase.run();
  endMark(phase.name, value);
}
