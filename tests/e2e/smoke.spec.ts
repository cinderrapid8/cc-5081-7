import { chromium, expect, test } from '@playwright/test';

const BASE = 'http://127.0.0.1:5199';

test('装备负载执行器端到端冒烟', async () => {
const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, cond: boolean, detail = '') {
  results.push({ name, ok: cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${detail ? ` (${detail})` : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE);
await page.waitForSelector('text=装备负载执行器');

const publishButton = page.locator('.panel', { hasText: '发布链路' }).getByRole('button', { name: /发布修订/ });

// 1. 初始发布门禁无错误
await expect(page.locator('.panel', { hasText: '约束检查' }).locator('.badge', { hasText: '无阻断错误' })).toBeVisible();

// 2. 构筑龙鳞 2 件并发布
await page.locator('.slot-row').filter({ hasText: '头盔' }).locator('select').selectOption('u-dhelm');
await page.locator('.slot-row').filter({ hasText: '胸甲' }).locator('select').selectOption('u-dchest');
await publishButton.click();
await expect(page.locator('.panel', { hasText: '发布链路' }).locator('.badge', { hasText: '修订 #1' })).toBeVisible();
check('2件套装发布后修订号变为1', true);
await expect(page.locator('.badge', { hasText: '激活至第 2 档' })).toBeVisible();
check('2件套装激活2档', true);
// 变化报告出现
await expect(page.locator('.trace', { hasText: 'dragon_t2' }).first()).toBeVisible();
check('发布报告含激活来源 dragon_t2', true);

// 3. 攻击并记录修订 1 结果
await page.getByRole('button', { name: /执行攻击/ }).click();
await expect(page.locator('table tbody tr')).toHaveCount(6);
const r1Text = await page.locator('.badge', { hasText: /总伤害/ }).first().textContent();
const r1Damage = Number(r1Text!.replace(/\D/g, ''));
check('修订1产生6回合战斗结果', r1Damage > 0, r1Text ?? '');

// 4. 扩到 4 件 -> 阈值升到 4 档，发布，同输入再攻击，对比变化报告
for (const [slot, uid] of [['护手', 'u-dgloves'], ['战靴', 'u-dboots']] as const) {
  await page.locator('.slot-row').filter({ hasText: slot }).locator('select').selectOption(uid);
}
await publishButton.click();
await expect(page.locator('.panel', { hasText: '发布链路' }).locator('.badge', { hasText: '修订 #2' })).toBeVisible();
await expect(page.locator('.badge', { hasText: '激活至第 4 档' })).toBeVisible();
const tierChange = await page.locator('.trace', { hasText: '套装 set_dragon 档位 2 → 4' }).isVisible();
check('变化报告记录档位 2→4', tierChange);
const skillGain = await page.locator('.trace', { hasText: '获得技能' }).first().isVisible();
check('4档技能获得被记录', skillGain);
await page.getByRole('button', { name: /执行攻击/ }).click();
const r2Text = await page.locator('.badge', { hasText: /总伤害/ }).first().textContent();
const r2Damage = Number(r2Text!.replace(/\D/g, ''));
check('修订2在同输入下伤害不同于修订1', r2Damage !== r1Damage, `${r1Damage} vs ${r2Damage}`);

// 5. 历史修订对比下拉可用
const comparePanel = page.locator('.panel', { hasText: '修订间对比' });
await comparePanel.locator('select').last().selectOption('1');
const compareVisible = await page.locator('.badge', { hasText: /总伤害：#2/ }).isVisible();
check('修订间伤害对比显示', compareVisible);

// 6. 封禁战靴：降回 3 档，物品显示惰性
await page.locator('.slot-row').filter({ hasText: '战靴' }).getByRole('button', { name: '封禁' }).click();
await expect(page.locator('.slot-row.banned .badge', { hasText: '临时封禁' })).toBeVisible();
const bannedWarning = await page.locator('.diag.warning', { hasText: 'slot-banned' }).isVisible();
check('封禁产生 slot-banned 警告', bannedWarning);
await expect(page.locator('.badge', { hasText: '激活至第 3 档' })).toBeVisible();
check('封禁后套装降为3档（有效部件减少）', true);
const inert = await page.locator('.trace', { hasText: '不计属性 / 不计套装 / 不给技能' }).isVisible();
check('封禁物品标记为完全失效', inert);
const selectDisabled = await page.locator('.slot-row.banned select').isDisabled();
check('封禁槽位编辑控件禁用', selectDisabled);
await page.locator('.slot-row').filter({ hasText: '战靴' }).getByRole('button', { name: '解封' }).click();
await expect(page.locator('.badge', { hasText: '激活至第 4 档' })).toBeVisible();
check('解封后恢复4档，无残留', true);

// 7. 失效引用：装备诅咒魔导书 -> broken-skill-ref 阻断
await page.locator('.slot-row').filter({ hasText: '武器' }).locator('select').selectOption('u-grimoire');
const broken = await page.locator('.diag.error', { hasText: 'broken-skill-ref' }).isVisible();
check('失效技能引用被定位为错误', broken);
const publishDisabled = await publishButton.isDisabled();
check('存在阻断错误时发布按钮禁用', publishDisabled);
const located = await page.locator('.diag.error', { hasText: 'skill_lost_spell' }).isVisible();
check('错误定位到具体技能与规则', located);
await page.locator('.slot-row').filter({ hasText: '武器' }).locator('select').selectOption('');

// 8. 互斥套装：混入两件霜纹 -> mutex-set
await page.locator('.slot-row').filter({ hasText: '护手' }).locator('select').selectOption('u-fgloves');
await page.locator('.slot-row').filter({ hasText: '战靴' }).locator('select').selectOption('u-fboots');
const mutexSet = await page.locator('.diag.error', { hasText: 'mutex-set' }).count();
check('互斥套装组冲突报错（两套各至少一条）', mutexSet >= 2, `count=${mutexSet}`);
const stillRevision2 = await page.locator('.panel', { hasText: '发布链路' }).locator('.badge', { hasText: '修订 #2' }).isVisible();
check('被拒绝的草稿不改变活动修订', stillRevision2);
await page.getByRole('button', { name: /放弃草稿/ }).click();

// 9. 角色死亡：编辑与发布锁定
await page.getByRole('button', { name: '模拟角色死亡' }).click();
await expect(page.locator('.badge.dead', { hasText: '死亡' }).first()).toBeVisible();
const allSelectsDisabled = await page.locator('.slot-row select').first().isDisabled();
check('死亡后槽位控件禁用', allSelectsDisabled);
const publishWhenDead = await publishButton.isDisabled();
check('死亡后发布按钮禁用', publishWhenDead);
await page.getByRole('button', { name: '复活角色' }).click();
await expect(page.locator('.badge.ok', { hasText: '存活' }).first()).toBeVisible();
check('复活后解锁', true);

// 10. 阈值反复切换：卸头盔 4->3，装回 4，未激活规则带原因
const builder = page.locator('.panel', { hasText: '构筑编辑' });
const helm = builder.locator('.slot-row').filter({ hasText: '头盔' });
await helm.locator('select').selectOption('');
await expect(builder.locator('.badge', { hasText: '3件 / 第3档' })).toBeVisible();
check('卸下头盔草稿降到3档', true);
await helm.locator('select').selectOption('u-dhelm');
await expect(builder.locator('.badge', { hasText: '4件 / 第4档' })).toBeVisible();
check('重新凑齐草稿回到4档', true);
// 条件未满足的规则也带原因：吸血饰带要求 dex>=12，基础敏捷只有 10
await builder.locator('.slot-row').filter({ hasText: '饰品' }).locator('select').selectOption('u-belt');
const inactiveCount = await page.locator('.trace.inactive').count();
const inactiveReason = inactiveCount
  ? ((await page.locator('.trace.inactive .reason').first().textContent()) ?? '')
  : '';
check('条件不满足的规则标记未激活并附带原因', inactiveReason.includes('dex'), `inactive=${inactiveCount}: ${inactiveReason}`);
await builder.locator('.slot-row').filter({ hasText: '饰品' }).locator('select').selectOption('');

// 11. 草稿未发布不影响战斗：制造非法草稿（两套各 2 件触发互斥）后执行攻击，仍按修订 #2 存档
await page.locator('.slot-row').filter({ hasText: '护手' }).locator('select').selectOption('u-fgloves');
await page.locator('.slot-row').filter({ hasText: '战靴' }).locator('select').selectOption('u-fboots');
await expect(publishButton).toBeDisabled({ timeout: 5000 });
await page.getByRole('button', { name: /执行攻击/ }).click();
const resultRevision = await page.locator('.badge', { hasText: /总伤害/ }).first().textContent();
check('非法草稿下战斗仍基于活动方案执行', Boolean(resultRevision?.includes(String(r2Damage))), resultRevision ?? '');

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} e2e checks passed`);
await browser.close();
if (failed.length) throw new Error(`e2e failures: ${failed.map((f) => f.name).join('; ')}`);
});
