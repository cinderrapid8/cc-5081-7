import { mulberry32 } from './rng';
import type { DamageElement, DerivedState, SkillDef, StatMap } from './types';

export interface CombatDummy {
  name: string;
  hp: number;
  def: number;
  attack: number;
}

export interface AttackInput {
  /** 相同 seed + turns + element 保证不同负载的对比输入完全一致 */
  seed: number;
  turns: number;
  element: DamageElement;
}

export interface TurnLog {
  turn: number;
  dealt: number;
  taken: number;
  crit: boolean;
  hasteProc: boolean;
  shieldAbsorb: number;
  healed: number;
  hpAfter: number;
  shieldAfter: number;
  dummyHpAfter: number;
  appliedSkills: string[];
  note?: string;
}

export interface CombatResult {
  input: AttackInput;
  revision: number;
  logs: TurnLog[];
  totalDamage: number;
  finalHp: number;
  finalShield: number;
  dead: boolean;
  dummyDead: boolean;
}

export interface Combatant {
  baseStats: StatMap;
  derived: DerivedState;
  revision: number;
  skills: Record<string, SkillDef>;
}

const DEFAULT_CRIT_DAMAGE = 1.5;

function effectiveStats(c: Combatant): StatMap {
  return { ...c.baseStats, ...c.derived.stats };
}

function elementalBonus(stats: StatMap, element: DamageElement): number {
  if (element === 'fire') return stats.fireDamage ?? 0;
  if (element === 'ice') return stats.iceDamage ?? 0;
  return 0;
}

/** 用同一攻击输入对某一已发布负载（派生状态）执行确定性战斗 */
export function runCombat(c: Combatant, dummy: CombatDummy, input: AttackInput): CombatResult {
  const stats = effectiveStats(c);
  const rng = mulberry32(input.seed);

  const maxHp = stats.hp ?? 0;
  let hp = maxHp;
  let shield = stats.shield ?? 0;
  let dummyHp = dummy.hp;
  let totalDamage = 0;
  const logs: TurnLog[] = [];

  const activeSkills = c.derived.skills
    .map((id) => c.skills[id])
    .filter((s): s is SkillDef => Boolean(s));

  for (let turn = 1; turn <= input.turns; turn++) {
    const appliedSkills: string[] = [];

    if (hp <= 0) {
      logs.push({
        turn,
        dealt: 0,
        taken: 0,
        crit: false,
        hasteProc: false,
        shieldAbsorb: 0,
        healed: 0,
        hpAfter: hp,
        shieldAfter: shield,
        dummyHpAfter: dummyHp,
        appliedSkills,
        note: '角色已死亡，无法继续攻击；死亡状态下禁止换装，复活前战斗结果不再变化',
      });
      continue;
    }

    // 回合开始：技能护盾（首回合前已持有装备护盾，技能护盾从第二回合起结算）
    if (turn > 1) {
      for (const skill of activeSkills) {
        for (const hook of skill.hooks) {
          if (hook.kind === 'turnStartShield') {
            shield += hook.amount;
            appliedSkills.push(skill.id);
          }
        }
      }
    }

    // 攻击结算
    const atk = (stats.atk ?? 0) + elementalBonus(stats, input.element);
    const critRoll = rng();
    const crit = critRoll < (stats.critChance ?? 0);
    const critMult = crit ? (stats.critDamage ?? DEFAULT_CRIT_DAMAGE) : 1;

    let dealt = Math.max(1, Math.floor(atk * critMult));
    for (const skill of activeSkills) {
      for (const hook of skill.hooks) {
        if (hook.kind !== 'damageDealtMultiplier' && hook.kind !== 'damageDealtBonus') continue;
        if (hook.element && hook.element !== input.element) continue;
        if (hook.kind === 'damageDealtMultiplier') {
          dealt = Math.floor(dealt * hook.factor);
          appliedSkills.push(skill.id);
        } else {
          dealt += hook.amount;
          appliedSkills.push(skill.id);
        }
      }
    }

    // 急速：独立掷骰，触发时追加 50% 伤害
    const hasteRoll = rng();
    const hasteProc = hasteRoll < (stats.haste ?? 0);
    if (hasteProc) dealt = Math.floor(dealt * 1.5);

    dealt = Math.max(1, dealt - dummy.def);
    dummyHp = Math.max(0, dummyHp - dealt);
    totalDamage += dealt;

    // 吸血（装备词条 + 技能钩子）
    let healed = 0;
    const lifestealStat = stats.lifesteal ?? 0;
    let lifestealPercent = lifestealStat;
    for (const skill of activeSkills) {
      for (const hook of skill.hooks) {
        if (hook.kind === 'lifestealPercent') {
          lifestealPercent += hook.percent;
          appliedSkills.push(skill.id);
        }
      }
    }
    if (lifestealPercent > 0) {
      healed = Math.floor((dealt * lifestealPercent) / 100);
      hp = Math.min(maxHp, hp + healed);
    }

    // 假人反击：防御与护盾结算
    let taken = Math.max(0, dummy.attack - (stats.def ?? 0));
    const mit = stats.physicalMitigation ?? 0;
    taken = Math.floor(taken * (1 - mit));
    for (const skill of activeSkills) {
      for (const hook of skill.hooks) {
        if (hook.kind !== 'damageTakenMultiplier') continue;
        if (hook.element && hook.element !== 'physical') continue;
        taken = Math.floor(taken * hook.factor);
        appliedSkills.push(skill.id);
      }
    }

    let shieldAbsorb = 0;
    if (taken > 0) {
      shieldAbsorb = Math.min(shield, taken);
      shield -= shieldAbsorb;
      taken -= shieldAbsorb;
      hp = Math.max(0, hp - taken);
    }

    logs.push({
      turn,
      dealt,
      taken,
      crit,
      hasteProc,
      shieldAbsorb,
      healed,
      hpAfter: hp,
      shieldAfter: shield,
      dummyHpAfter: dummyHp,
      appliedSkills: [...new Set(appliedSkills)],
    });

    if (dummyHp <= 0) break;
  }

  return {
    input,
    revision: c.revision,
    logs,
    totalDamage,
    finalHp: hp,
    finalShield: shield,
    dead: hp <= 0,
    dummyDead: dummyHp <= 0,
  };
}
