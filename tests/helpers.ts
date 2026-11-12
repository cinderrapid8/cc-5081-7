import { generateScaleCatalog, scaledBaseStats, smallScenario } from '../bench/scenario';
import type { Catalog, Loadout, StatMap } from '../src/domain/types';

export type { Catalog, Loadout, StatMap };

export interface SyntheticScenario {
  catalog: Catalog;
  inventory: { uid: string; itemId: string }[];
  slotOptions: Record<string, string[]>;
  baseStats: StatMap;
}

/** 测试用合成目录：固定参数与种子，保证可复现 */
export function buildSynthetic(opts: {
  slots: number;
  variantsPerSlot?: number;
  sets: number;
  tiers: number;
  effectsPerItem?: number;
}): SyntheticScenario {
  const generated = generateScaleCatalog({
    slotCount: opts.slots,
    variantsPerSlot: opts.variantsPerSlot ?? 4,
    effectsPerItem: opts.effectsPerItem ?? 3,
    setCount: opts.sets,
    tiersPerSet: opts.tiers,
    statPool: 15,
    tagPool: 8,
    seed: 424242,
  });
  return {
    ...generated,
    baseStats: scaledBaseStats(15),
  };
}

export { smallScenario };
